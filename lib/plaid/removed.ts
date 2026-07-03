/**
 * C4: `transactions.plaid_removed_at` is stamped when Plaid reports a charge removed/reversed
 * (see stampRemovedTransactions in run-sync.ts). Such a row is NOT real spend and must be excluded
 * from every report, roll-up, and backlog count.
 *
 * This is the pure JS-side predicate mirroring the `.is("plaid_removed_at", null)` SQL filter, so
 * anywhere we filter rows in Node agrees with anywhere we push the filter into PostgREST.
 */
export function isPlaidRemoved(row: { plaid_removed_at: string | null }): boolean {
  return Boolean(row.plaid_removed_at);
}
