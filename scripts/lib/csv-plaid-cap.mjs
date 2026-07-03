// C6: cap a CSV import window at an account's Plaid cutover so CSV rows never re-import a window
// Plaid already owns. Plaid delivers each charge under its own raw descriptor + transaction_id;
// the CSV descriptors won't business-key-match those, so a CSV row on/after sync_from_date lands as
// a SECOND copy of a charge Plaid already imported → duplicate. Pure module (no I/O) so the script
// can load links itself and hand the resolved facts in.

/**
 * Compute the effective (EXCLUSIVE) upper bound for a CSV import so no CSV row on/after the Plaid
 * cutover is imported. The importer's dateTo is EXCLUSIVE (inDateRange keeps `d < to`) and Plaid owns
 * every row `>= sync_from_date`, so the correct cap is `sync_from_date` ITSELF: `d < sync_from_date`
 * keeps everything strictly before the cutover (through `sync_from_date - 1`) and excludes the cutover
 * day onward. The CSV and Plaid windows therefore meet contiguously at the seam — capping at the
 * day-before would double-apply the exclusivity and silently drop the `sync_from_date - 1` row, which
 * (since sync_from_date is derived as MAX(transaction_date)+1) is exactly the CSV→Plaid hand-off seam
 * and the most likely day to carry real CSV rows.
 *
 * Returns `requestedTo` unchanged (capped=false) when the account has no Plaid link, has no
 * sync_from_date, or `force` is set. Otherwise `effectiveTo = min(requestedTo, syncFromDate)`, with
 * `capped` true only when that actually moved the bound earlier than what was requested (so an
 * already-tighter requestedTo isn't reported as a Plaid cap).
 *
 * @param {{ requestedTo: string | null, syncFromDate: string | null, hasPlaidLink: boolean, force: boolean }} params
 * @returns {{ effectiveTo: string | null, capped: boolean }}
 */
export function capCsvWindowForPlaid({ requestedTo, syncFromDate, hasPlaidLink, force }) {
  if (force || !hasPlaidLink || !syncFromDate) {
    return { effectiveTo: requestedTo, capped: false };
  }
  const cap = syncFromDate;
  // No requestedTo bound, or requestedTo is later than the cap → the cap tightens the window.
  if (requestedTo === null || requestedTo > cap) {
    return { effectiveTo: cap, capped: true };
  }
  // requestedTo already at/inside the cap → keep it; the Plaid cap didn't change anything.
  return { effectiveTo: requestedTo, capped: false };
}
