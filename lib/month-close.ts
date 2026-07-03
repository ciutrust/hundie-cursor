/**
 * Month Close / Tax Close roll-up logic (pure, testable).
 *
 * "Done" is auto-computed: an (entity, month) cell is CLOSED when it has activity
 * and zero backlog (0 unclassified + 0 "Ask My Accountant"). A month is closed when
 * every entity with activity that month is closed; the year is tax-close ready when
 * no month is still open.
 */
/**
 * `orphanCount` (C9): transactions in this (entity, month) with NO classifications row — a
 * classification insert failed mid-import. An orphan is an unbooked charge, so it counts as
 * activity AND as backlog: a month with orphans can never read empty or closed while they remain.
 *
 * `changedCount` (C8): classified transactions in this (entity, month) whose amount/date/description
 * was edited AFTER the fact (recorded by the `transaction_history` audit trigger). This is a WARNING
 * indicator only — it is DELIBERATELY NOT part of `cellStatus`/`rollupStatus` (a change does not move a
 * cell between open/closed/empty). It only matters on a month that OTHERWISE reads closed, where a
 * silent post-close reshape means the operator should re-verify. See `isChangedSinceClose`.
 */
export type MonthCloseCell = {
  hasActivity: boolean;
  backlogCount: number;
  orphanCount: number;
  changedCount: number;
};
export type CloseStatus = "closed" | "open" | "empty";

/** A cell is "active" when it has classified activity OR at least one orphan (unbooked) charge. */
function cellIsActive(cell: MonthCloseCell): boolean {
  return cell.hasActivity || cell.orphanCount > 0;
}

/** Remaining work in a cell: review backlog + orphans (both must clear to close). */
function cellOpenCount(cell: MonthCloseCell): number {
  return cell.backlogCount + cell.orphanCount;
}

export function cellStatus(cell: MonthCloseCell): CloseStatus {
  if (!cellIsActive(cell)) return "empty";
  return cellOpenCount(cell) === 0 ? "closed" : "open";
}

/**
 * C8: "changed since close" — a WARNING, not a status. True only when a cell OTHERWISE reads closed
 * (active + zero backlog + zero orphans) AND has ≥1 post-close field change. On an OPEN cell the
 * backlog already signals work; on an EMPTY cell there is nothing to have reshaped. Kept out of
 * cellStatus/rollupStatus on purpose so a change never flips a month open/closed.
 */
export function isChangedSinceClose(cell: MonthCloseCell): boolean {
  return cellStatus(cell) === "closed" && cell.changedCount > 0;
}

/** Roll a set of cells (a month across entities, or an entity across months) into one status. */
export function rollupStatus(cells: MonthCloseCell[]): CloseStatus {
  if (!cells.some(cellIsActive)) return "empty";
  return cells.some((cell) => cellOpenCount(cell) > 0) ? "open" : "closed";
}

export type YearSummary = { active: number; closed: number; open: number; taxCloseReady: boolean };

export function summarizeMonths(monthStatuses: CloseStatus[]): YearSummary {
  const active = monthStatuses.filter((status) => status !== "empty").length;
  const closed = monthStatuses.filter((status) => status === "closed").length;
  const open = monthStatuses.filter((status) => status === "open").length;
  // Ready only when there is activity and nothing is still open.
  return { active, closed, open, taxCloseReady: active > 0 && open === 0 };
}
