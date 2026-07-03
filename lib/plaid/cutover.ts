import type { createServiceRoleClient } from "@/lib/supabase/service-role";

type Admin = ReturnType<typeof createServiceRoleClient>;

/**
 * C3: derive the CSV→Plaid cutover date for a set of mapped Hundie accounts as
 * MAX(transaction_date) + 1 across their existing ledger rows. This is the day after the last
 * imported (CSV/manual) transaction, so Plaid takes over exactly where the ledger left off and the
 * gap between the CSV's last row and the Plaid link date is not silently dropped.
 *
 * Returns null when the mapped accounts have no ledger rows yet — the caller then leaves
 * sync_from_date NULL, and run-sync's resolveSyncFromDate null-guard (fall back to today + warn)
 * applies. UTC arithmetic (T00:00:00.000Z + setUTCDate) avoids an off-by-one across time zones / DST.
 */
export async function deriveCutoverDate(
  admin: Admin,
  accountIds: string[],
): Promise<string | null> {
  if (accountIds.length === 0) return null;
  const { data } = await admin
    .from("transactions")
    .select("transaction_date")
    .in("account_id", accountIds)
    .order("transaction_date", { ascending: false })
    .range(0, 0);
  const maxDate = data?.[0]?.transaction_date as string | undefined;
  if (!maxDate) return null;
  const d = new Date(`${maxDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * C3: whether to persist a computed cutover for this map-accounts call. `sync_from_date` is
 * NOT NULL with `default current_date` (BUG-06), so it always has a value from the moment the
 * connection row is inserted — a `.is('sync_from_date', null)` guard can never distinguish "not
 * set yet" from "already set", so it can never fire. First-ever-mapping (no existing
 * plaid_account_links rows for this connection) is the real signal: persist the derived/override
 * cutover then, and never on a re-map, so an established cutover is only changed by an operator
 * explicitly clearing it or passing an override.
 */
export function shouldPersistCutover(
  existingLinkCountForConnection: number,
  cutoverDate: string | null,
): boolean {
  return existingLinkCountForConnection === 0 && cutoverDate !== null;
}
