// C6: cap a CSV import window at an account's Plaid cutover so CSV rows never re-import a window
// Plaid already owns. Plaid delivers each charge under its own raw descriptor + transaction_id;
// the CSV descriptors won't business-key-match those, so a CSV row on/after sync_from_date lands as
// a SECOND copy of a charge Plaid already imported → duplicate. Pure module (no I/O) so the script
// can load links itself and hand the resolved facts in.

/**
 * The calendar day before an ISO `YYYY-MM-DD` date, in UTC (T00:00:00.000Z + setUTCDate avoids an
 * off-by-one across time zones / DST — same pattern as deriveCutoverDate).
 * @param {string} isoDate
 * @returns {string}
 */
export function dayBefore(isoDate) {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Compute the effective (EXCLUSIVE) upper bound for a CSV import so no CSV row dated on/after the
 * Plaid cutover is imported. The importer's dateTo is EXCLUSIVE (inDateRange keeps `d < to`), so to
 * exclude sync_from_date itself and everything after it, the cap is `dayBefore(syncFromDate)`.
 *
 * Returns `requestedTo` unchanged (capped=false) when the account has no Plaid link, has no
 * sync_from_date, or `force` is set. Otherwise `effectiveTo = min(requestedTo, dayBefore(sync))`,
 * with `capped` true only when that actually moved the bound earlier than what was requested (so an
 * already-tighter requestedTo isn't reported as a Plaid cap).
 *
 * @param {{ requestedTo: string | null, syncFromDate: string | null, hasPlaidLink: boolean, force: boolean }} params
 * @returns {{ effectiveTo: string | null, capped: boolean }}
 */
export function capCsvWindowForPlaid({ requestedTo, syncFromDate, hasPlaidLink, force }) {
  if (force || !hasPlaidLink || !syncFromDate) {
    return { effectiveTo: requestedTo, capped: false };
  }
  const cap = dayBefore(syncFromDate);
  // No requestedTo bound, or requestedTo is later than the cap → the cap tightens the window.
  if (requestedTo === null || requestedTo > cap) {
    return { effectiveTo: cap, capped: true };
  }
  // requestedTo already at/inside the cap → keep it; the Plaid cap didn't change anything.
  return { effectiveTo: requestedTo, capped: false };
}
