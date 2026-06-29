import { aggregator, type AggregatorTransaction } from "@/lib/aggregator";
import { decryptSecret } from "@/lib/crypto/secret-box";
import { shouldImportPlaidTxn } from "@/lib/plaid/ledger-filter";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
// The proven CSV write path (dedupe via import_hash, entity routing, classification upsert).
// Plain JS — reused verbatim so Plaid is "just another import source".
import {
  buildImportPlanFromTransactions,
  importAccountPlan,
  partitionRowsByExistingExternalId,
  updateTransactionsByExternalId,
} from "@/scripts/lib/ledger-import.mjs";

type Admin = ReturnType<typeof createServiceRoleClient>;

type AccountRow = {
  id: string;
  slug: string;
  display_name: string;
  account_type: string;
  default_entity_id: string;
  date_rules: unknown;
  default_entity: { slug: string } | null;
};

export type ConnectionSyncResult = {
  connectionId: string;
  institution: string | null;
  inserted: number;
  updated: number;
  skipped: number;
  status: string;
  error?: string;
};

export type SyncSummary = {
  inserted: number;
  updated: number;
  skipped: number;
  connections: ConnectionSyncResult[];
};

const REAUTH_RE = /ITEM_LOGIN_REQUIRED|login_required|reauth/i;

/**
 * BUG-06 guard: a NULL sync_from_date would let Plaid pull FULL history (dateFrom=null) and
 * double-count the CSV-backfilled window (CSV and Plaid rows hash differently, so UNIQUE(account_id,
 * import_hash) does not dedupe them). Until the column is backfilled + NOT NULL (Stage 2), fall back
 * to `todayIso` so a null can never silently import history; surface a warning so the operator sets a
 * real cutover date.
 */
export function resolveSyncFromDate(
  syncFromDate: string | null | undefined,
  todayIso: string,
): { dateFrom: string; warning: string | null } {
  if (syncFromDate) return { dateFrom: syncFromDate, warning: null };
  return {
    dateFrom: todayIso,
    warning: `sync_from_date is null — falling back to ${todayIso} (no historical backfill). Set a cutover date for this connection.`,
  };
}

/**
 * BUG-09/DATA-02: stamp plaid_removed_at on transactions Plaid reported as removed, located by
 * external_id (BUG-01). Idempotent (`.is("plaid_removed_at", null)` skips already-stamped rows).
 * Never deletes — a removed row may carry a human classification, so it is surfaced for human review.
 * Scoped to the connection's own linked accounts so a globally-unique Plaid id can't touch another
 * connection. Returns the number of rows newly stamped.
 */
export async function stampRemovedTransactions(
  admin: Admin,
  accountIds: string[],
  removedExternalIds: string[],
  nowIso: string,
): Promise<number> {
  if (accountIds.length === 0 || removedExternalIds.length === 0) return 0;
  const { data, error } = await admin
    .from("transactions")
    .update({ plaid_removed_at: nowIso })
    .in("account_id", accountIds)
    .in("external_id", removedExternalIds)
    .is("plaid_removed_at", null)
    .select("id");
  if (error) throw new Error(`Failed to stamp removed transactions: ${error.message}`);
  return (data ?? []).length;
}

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
      .select("id, institution, access_token_cipher, sync_cursor, status, sync_from_date"),
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
  // BUG-09: a per-connection account list so removed-transaction stamping is scoped to the
  // connection's own accounts (a globally-unique Plaid id must never touch another connection).
  const accountIdsByConnection = new Map<string, string[]>();
  for (const l of links ?? []) {
    accountIdByPlaid.set(l.plaid_account_id, l.account_id);
    linkedAccountIds.add(l.account_id);
    const arr = accountIdsByConnection.get(l.connection_id) ?? [];
    if (!arr.includes(l.account_id)) arr.push(l.account_id);
    accountIdsByConnection.set(l.connection_id, arr);
  }

  const accountById = new Map<string, AccountRow>();
  if (linkedAccountIds.size > 0) {
    const { data: accounts, error: aErr } = await admin
      .from("accounts")
      .select(
        "id, slug, display_name, account_type, default_entity_id, date_rules, default_entity:entities!accounts_default_entity_id_fkey(slug)",
      )
      .in("id", [...linkedAccountIds]);
    if (aErr) throw aErr;
    // The untyped client types the to-one `default_entity` embed as an array; it's an object at
    // runtime (many-to-one FK), so cast through unknown.
    for (const a of accounts ?? []) accountById.set(a.id, a as unknown as AccountRow);
  }

  const summary: SyncSummary = { inserted: 0, updated: 0, skipped: 0, connections: [] };

  for (const conn of connections ?? []) {
    const result: ConnectionSyncResult = {
      connectionId: conn.id,
      institution: conn.institution,
      inserted: 0,
      updated: 0,
      skipped: 0,
      status: conn.status,
    };

    try {
      let token: string;
      try {
        token = decryptSecret(conn.access_token_cipher);
      } catch {
        // GCM fails loudly on a wrong/changed key — never silent. Guide the operator to re-link.
        await admin
          .from("bank_connections")
          .update({ status: "needs_reauth", updated_at: new Date().toISOString() })
          .eq("id", conn.id);
        result.status = "needs_reauth";
        result.error =
          "Could not decrypt the saved token (encryption key may have changed) — remove and re-link this bank.";
        summary.connections.push(result);
        continue;
      }
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

      // BUG-01: a transaction may appear in BOTH `added` and `modified` within one sync window;
      // the `modified` copy is the newer state, so it wins. De-overlap by externalId up front so the
      // same id never produces two plan rows (which would collide on the external_id index). Routing
      // by external_id EXISTENCE (below) then sends known ids to UPDATE-in-place and only genuinely
      // new ids to INSERT — so a `modified` (or an `added` re-labeled on a cursor reset) never
      // double-counts.
      const modifiedIds = new Set(synced.data.modified.map((t) => t.externalId));
      const incoming = [
        ...synced.data.modified,
        ...synced.data.added.filter((t) => !modifiedIds.has(t.externalId)),
      ];

      if (synced.data.removedExternalIds.length > 0) {
        // BUG-09/DATA-02: don't auto-delete (a removed row may carry a human classification). Stamp
        // plaid_removed_at (located by external_id) so the row is surfaced for human review instead
        // of silently lingering.
        const stamped = await stampRemovedTransactions(
          admin,
          accountIdsByConnection.get(conn.id) ?? [],
          synced.data.removedExternalIds,
          new Date().toISOString(),
        );
        console.log(
          `  Plaid reported ${synced.data.removedExternalIds.length} removed txn(s) for ${conn.id}; stamped ${stamped} for review (left in place)`,
        );
      }

      const { dateFrom: syncFromDate, warning: syncWarning } = resolveSyncFromDate(
        conn.sync_from_date,
        new Date().toISOString().slice(0, 10),
      );
      if (syncWarning) console.warn(`  ${conn.id}: ${syncWarning}`);

      const byPlaidAccount = new Map<string, AggregatorTransaction[]>();
      for (const t of incoming) {
        const arr = byPlaidAccount.get(t.accountExternalId) ?? [];
        arr.push(t);
        byPlaidAccount.set(t.accountExternalId, arr);
      }

      for (const [plaidAccountId, txns] of byPlaidAccount) {
        const accountId = accountIdByPlaid.get(plaidAccountId);
        if (!accountId) continue; // unmapped Plaid account → don't sync
        const account = accountById.get(accountId);
        if (!account) continue;

        // Drop card payments + $0 noise (parity with the CSV parsers). Checking/savings deposits are
        // now KEPT (income capture, Phase 3) and land uncategorized for the operator to classify.
        const eligible = txns.filter((t) => shouldImportPlaidTxn(t, account.account_type));
        if (eligible.length === 0) continue;

        const parsed = eligible.map((t) => ({
          transactionDate: t.transactionDate,
          postedDate: t.postedDate,
          amount: t.amount,
          description: t.description,
          vendor: t.vendor,
          rawCategory: t.rawCategory,
          issuerReference: t.externalId, // → import_hash (per-txn-unique; keeps `added` idempotent)
          externalId: t.externalId, // BUG-01: → transactions.external_id + modify routing
          sourceRowIndex: undefined,
        }));

        // sync_from_date bounds the pull so Plaid never re-imports the CSV-backfilled window
        // (BUG-06: resolveSyncFromDate guarantees a non-null lower bound).
        const plan = buildImportPlanFromTransactions(account, `plaid:${conn.id}`, parsed, entityMap, {
          dateFrom: syncFromDate,
        });

        // BUG-01: a known external_id UPDATEs in place (preserving its classification); only genuinely
        // new external_ids insert. This routes `modified` events — and `added` re-labels on a cursor
        // reset — to UPDATE instead of inserting a second row.
        const { existing, fresh } = await partitionRowsByExistingExternalId(
          admin,
          account.id,
          plan.rows,
        );
        const { updated, unmatched } = await updateTransactionsByExternalId(
          admin,
          account.id,
          existing,
        );
        result.updated += updated;

        const insertRows = [...fresh, ...unmatched];
        if (insertRows.length > 0) {
          const res = await importAccountPlan(
            admin,
            { ...plan, rows: insertRows },
            { sourceType: "plaid_sync" },
          );
          result.inserted += res.inserted;
          result.skipped += res.skipped;
        }
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
    summary.updated += result.updated;
    summary.skipped += result.skipped;
    summary.connections.push(result);
  }

  return summary;
}
