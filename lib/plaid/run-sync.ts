import { aggregator, type AggregatorTransaction } from "@/lib/aggregator";
import { decryptSecret } from "@/lib/crypto/secret-box";
import {
  shouldImportPlaidTxn,
  summarizePlaidDrops,
  type PlaidDropReason,
  type PlaidDropSummary,
} from "@/lib/plaid/ledger-filter";
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
 * C2: /transactions/sync is forward-only — a dropped `added` row never re-delivers. If any incoming
 * Plaid account id is unmapped (no plaid_account_links row) we must NOT advance the cursor, or those
 * rows are permanently lost. Returns the unmapped Plaid account ids (empty = safe to persist cursor).
 */
export function unmappedPlaidAccountIds(
  incomingPlaidAccountIds: Iterable<string>,
  accountIdByPlaid: Map<string, string>,
): string[] {
  const unmapped = new Set<string>();
  for (const id of incomingPlaidAccountIds) {
    if (!accountIdByPlaid.has(id)) unmapped.add(id);
  }
  return [...unmapped];
}

/**
 * C20: from a batch of Plaid `modified` events, the external_ids that must be routed to
 * removal-stamping — i.e. rows whose NEW state now FAILS shouldImportPlaidTxn for this account type
 * (Plaid re-reported the charge as a payment/transfer, or it went pending) AND that ALREADY EXIST in
 * the ledger. Without this, the eligible filter silently drops the modified copy while the STALE
 * pre-modification row lingers, overstating expenses.
 *
 * Pure: depends only on shouldImportPlaidTxn + membership in `existingExternalIds`. Guard (critical):
 * a modified id that was never imported is NEVER returned — stamping it would create a phantom
 * removal. Order/dedup follows first appearance in `modifiedTxns`.
 */
export function ineligibleModifiedToRemove(
  modifiedTxns: ReadonlyArray<AggregatorTransaction>,
  accountType: string,
  existingExternalIds: Set<string>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of modifiedTxns) {
    if (shouldImportPlaidTxn(t, accountType)) continue; // still eligible → keep as-is
    if (!existingExternalIds.has(t.externalId)) continue; // never imported → no phantom removal
    if (seen.has(t.externalId)) continue;
    seen.add(t.externalId);
    out.push(t.externalId);
  }
  return out;
}

const DROP_REASONS: PlaidDropReason[] = ["pending", "zero", "pfc", "payment", "card_income"];

/**
 * C12: merge a per-account PlaidDropSummary into a running per-sync-run total (kept/dropped
 * counts add; sample descriptions cap at a few per reason so the log line stays short).
 */
function addPlaidDropSummary(total: PlaidDropSummary, next: PlaidDropSummary): PlaidDropSummary {
  const reasons = { ...total.reasons };
  const samples = { ...total.samples };
  for (const reason of DROP_REASONS) {
    reasons[reason] += next.reasons[reason];
    if (next.samples[reason]?.length) {
      const merged = [...(samples[reason] ?? []), ...next.samples[reason]!];
      samples[reason] = merged.slice(0, 3);
    }
  }
  return { kept: total.kept + next.kept, dropped: total.dropped + next.dropped, reasons, samples };
}

function emptyPlaidDropSummary(): PlaidDropSummary {
  return {
    kept: 0,
    dropped: 0,
    reasons: { pending: 0, zero: 0, pfc: 0, payment: 0, card_income: 0 },
    samples: {},
  };
}

/**
 * C12: format the per-import drop tally into a single log line (or null if nothing was dropped,
 * so callers can skip logging a no-op line). Visibility for rows previously dropped silently.
 */
export function formatPlaidDropSummaryLine(summary: PlaidDropSummary): string | null {
  if (summary.dropped === 0) return null;
  const reasonParts = DROP_REASONS.filter((r) => summary.reasons[r] > 0).map(
    (r) => `${r}=${summary.reasons[r]}`,
  );
  return `Plaid import: kept ${summary.kept}, dropped ${summary.dropped} (${reasonParts.join(", ")})`;
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
 * C20 support: of the given external_ids, the subset that ALREADY EXISTS in the ledger for this
 * account. Mirrors partitionRowsByExistingExternalId's query shape (eq account_id, in external_id).
 * Used to guard removal-stamping so a modified id that was never imported is never phantom-removed.
 */
export async function existingExternalIdsForAccount(
  admin: Admin,
  accountId: string,
  externalIds: string[],
): Promise<Set<string>> {
  const ids = [...new Set(externalIds.filter(Boolean))];
  if (ids.length === 0) return new Set();
  const { data, error } = await admin
    .from("transactions")
    .select("external_id")
    .eq("account_id", accountId)
    .in("external_id", ids);
  if (error) throw new Error(`external_id existence lookup failed: ${error.message}`);
  return new Set((data ?? []).map((r) => r.external_id as string));
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

  // C12: tally why rows are dropped across the whole run (kept pure via summarizePlaidDrops);
  // logged once at the end so previously-silent drops (esp. payment-name drops now scoped to
  // card accounts only) are visible per import.
  let dropSummary = emptyPlaidDropSummary();

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

      const connectionHasLinks = (accountIdsByConnection.get(conn.id) ?? []).length > 0;
      const unmapped = unmappedPlaidAccountIds(byPlaidAccount.keys(), accountIdByPlaid);
      if (!connectionHasLinks && byPlaidAccount.size > 0) {
        // Zero links yet: don't burn the initial full-sync cursor page — leave cursor untouched so a
        // later map-accounts run can still ingest this history.
        result.status = "needs_mapping";
        result.error = `${byPlaidAccount.size} Plaid account(s) not yet mapped — sync deferred until accounts are linked.`;
        summary.connections.push(result);
        continue;
      }

      for (const [plaidAccountId, txns] of byPlaidAccount) {
        const accountId = accountIdByPlaid.get(plaidAccountId);
        if (!accountId) continue; // unmapped Plaid account → don't sync
        const account = accountById.get(accountId);
        if (!account) continue;

        // Drop card payments + $0 noise (parity with the CSV parsers). Checking/savings deposits are
        // now KEPT (income capture, Phase 3) and land uncategorized for the operator to classify.
        const eligible = txns.filter((t) => shouldImportPlaidTxn(t, account.account_type));
        dropSummary = addPlaidDropSummary(dropSummary, summarizePlaidDrops(txns, account.account_type));

        // C20: a `modified` event whose NEW state now fails the filter (Plaid re-reported the charge
        // as a payment/transfer, or it went pending) would otherwise be silently dropped while its
        // STALE pre-modification row lingers in the ledger, overstating expenses. Route those to
        // removal-stamping — but ONLY for ids that ACTUALLY EXIST (guard against phantom removals).
        const modifiedInBatch = txns.filter((t) => modifiedIds.has(t.externalId));
        const ineligibleModified = modifiedInBatch.filter(
          (t) => !shouldImportPlaidTxn(t, account.account_type),
        );
        if (ineligibleModified.length > 0) {
          const existingIneligibleIds = await existingExternalIdsForAccount(
            admin,
            account.id,
            ineligibleModified.map((t) => t.externalId),
          );
          const toRemove = ineligibleModifiedToRemove(
            modifiedInBatch,
            account.account_type,
            existingIneligibleIds,
          );
          if (toRemove.length > 0) {
            const stamped = await stampRemovedTransactions(
              admin,
              [account.id],
              toRemove,
              new Date().toISOString(),
            );
            if (stamped > 0) {
              console.log(
                `  ${conn.id}/${account.slug}: ${stamped} modified txn(s) no longer ledger-eligible — stamped removed (stale expense cleared)`,
              );
            }
          }
        }

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

      if (unmapped.length === 0) {
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
      } else {
        // C2: do NOT advance the forward-only cursor — dropped rows would never re-deliver. Hold the
        // cursor so the next sync (after the operator maps these accounts) re-delivers the same window.
        await admin
          .from("bank_connections")
          .update({ status: "needs_mapping", updated_at: new Date().toISOString() })
          .eq("id", conn.id);
        result.status = "needs_mapping";
        result.error = `Unmapped Plaid account(s): ${unmapped.join(", ")}. Cursor held — map these accounts, then re-sync.`;
        console.warn(`  ${conn.id}: ${result.error}`);
      }
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

  // C12: one-line, per-import visibility into rows dropped and why (previously silent).
  const dropLine = formatPlaidDropSummaryLine(dropSummary);
  if (dropLine) console.log(`  ${dropLine}`);

  return summary;
}
