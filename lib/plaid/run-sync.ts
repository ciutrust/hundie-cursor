import { aggregator, type AggregatorTransaction } from "@/lib/aggregator";
import { decryptSecret } from "@/lib/crypto/secret-box";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
// The proven CSV write path (dedupe via import_hash, entity routing, classification upsert).
// Plain JS — reused verbatim so Plaid is "just another import source".
import {
  buildImportPlanFromTransactions,
  importAccountPlan,
} from "@/scripts/lib/ledger-import.mjs";

type Admin = ReturnType<typeof createServiceRoleClient>;

type AccountRow = {
  id: string;
  slug: string;
  display_name: string;
  default_entity_id: string;
  date_rules: unknown;
  default_entity: { slug: string } | null;
};

export type ConnectionSyncResult = {
  connectionId: string;
  institution: string | null;
  inserted: number;
  skipped: number;
  status: string;
  error?: string;
};

export type SyncSummary = {
  inserted: number;
  skipped: number;
  connections: ConnectionSyncResult[];
};

const REAUTH_RE = /ITEM_LOGIN_REQUIRED|login_required|reauth/i;

/**
 * Pull every connection's transactions and import them through the existing ledger pipeline.
 * Service-role only (creation has always been service-role). Posted-only ingestion; dedupe and
 * entity routing are inherited from buildImportPlanFromTransactions + importAccountPlan.
 */
export async function runPlaidSync(admin: Admin): Promise<SyncSummary> {
  const [
    { data: connections, error: cErr },
    { data: links, error: lErr },
    { data: entities, error: eErr },
  ] = await Promise.all([
    admin
      .from("bank_connections")
      .select("id, institution, access_token_cipher, sync_cursor, status"),
    admin.from("plaid_account_links").select("plaid_account_id, account_id, connection_id"),
    admin.from("entities").select("id, slug"),
  ]);
  if (cErr) throw cErr;
  if (lErr) throw lErr;
  if (eErr) throw eErr;

  const entityMap = new Map<string, string>();
  for (const e of entities ?? []) entityMap.set(e.slug, e.id);

  const accountIdByPlaid = new Map<string, string>();
  const linkedAccountIds = new Set<string>();
  for (const l of links ?? []) {
    accountIdByPlaid.set(l.plaid_account_id, l.account_id);
    linkedAccountIds.add(l.account_id);
  }

  const accountById = new Map<string, AccountRow>();
  if (linkedAccountIds.size > 0) {
    const { data: accounts, error: aErr } = await admin
      .from("accounts")
      .select(
        "id, slug, display_name, default_entity_id, date_rules, default_entity:entities!accounts_default_entity_id_fkey(slug)",
      )
      .in("id", [...linkedAccountIds]);
    if (aErr) throw aErr;
    // The untyped client types the to-one `default_entity` embed as an array; it's an object at
    // runtime (many-to-one FK), so cast through unknown.
    for (const a of accounts ?? []) accountById.set(a.id, a as unknown as AccountRow);
  }

  const summary: SyncSummary = { inserted: 0, skipped: 0, connections: [] };

  for (const conn of connections ?? []) {
    const result: ConnectionSyncResult = {
      connectionId: conn.id,
      institution: conn.institution,
      inserted: 0,
      skipped: 0,
      status: conn.status,
    };

    try {
      const token = decryptSecret(conn.access_token_cipher);
      const synced = await aggregator.syncTransactions(token, conn.sync_cursor);

      if (!synced.ok) {
        const status = REAUTH_RE.test(synced.error) ? "needs_reauth" : "error";
        await admin
          .from("bank_connections")
          .update({ status, updated_at: new Date().toISOString() })
          .eq("id", conn.id);
        result.status = status;
        result.error = synced.error;
        summary.connections.push(result);
        continue;
      }

      // Posted-only: pending transactions can have their amount/description revised when they
      // post, which would produce a second import_hash. Ingest once they settle.
      const posted = synced.data.added.filter((t) => !t.pending);

      const byPlaidAccount = new Map<string, AggregatorTransaction[]>();
      for (const t of posted) {
        const arr = byPlaidAccount.get(t.accountExternalId) ?? [];
        arr.push(t);
        byPlaidAccount.set(t.accountExternalId, arr);
      }

      for (const [plaidAccountId, txns] of byPlaidAccount) {
        const accountId = accountIdByPlaid.get(plaidAccountId);
        if (!accountId) continue; // unmapped Plaid account → don't sync
        const account = accountById.get(accountId);
        if (!account) continue;

        const parsed = txns.map((t) => ({
          transactionDate: t.transactionDate,
          postedDate: t.postedDate,
          amount: t.amount,
          description: t.description,
          vendor: t.vendor,
          rawCategory: t.rawCategory,
          issuerReference: t.externalId, // Plaid transaction_id → stable dedupe key
          sourceRowIndex: undefined,
        }));

        const plan = buildImportPlanFromTransactions(account, `plaid:${conn.id}`, parsed, entityMap, {});
        const res = await importAccountPlan(admin, plan, { sourceType: "plaid_sync" });
        result.inserted += res.inserted;
        result.skipped += res.skipped;
      }

      await admin
        .from("bank_connections")
        .update({
          sync_cursor: synced.data.cursor,
          last_synced_at: new Date().toISOString(),
          status: "healthy",
          updated_at: new Date().toISOString(),
        })
        .eq("id", conn.id);
      result.status = "healthy";
    } catch (e) {
      result.error = e instanceof Error ? e.message : "sync failed";
      result.status = "error";
      try {
        await admin
          .from("bank_connections")
          .update({ status: "error", updated_at: new Date().toISOString() })
          .eq("id", conn.id);
      } catch {
        // best-effort status write
      }
    }

    summary.inserted += result.inserted;
    summary.skipped += result.skipped;
    summary.connections.push(result);
  }

  return summary;
}
