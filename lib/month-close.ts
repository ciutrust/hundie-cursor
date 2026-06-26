/**
 * Month Close / Tax Close roll-up logic (pure, testable).
 *
 * "Done" is auto-computed: an (entity, month) cell is CLOSED when it has activity
 * and zero backlog (0 unclassified + 0 "Ask My Accountant"). A month is closed when
 * every entity with activity that month is closed; the year is tax-close ready when
 * no month is still open.
 */
export type MonthCloseCell = { hasActivity: boolean; backlogCount: number };
export type CloseStatus = "closed" | "open" | "empty";

export function cellStatus(cell: MonthCloseCell): CloseStatus {
  if (!cell.hasActivity) return "empty";
  return cell.backlogCount === 0 ? "closed" : "open";
}

/** Roll a set of cells (a month across entities, or an entity across months) into one status. */
export function rollupStatus(cells: MonthCloseCell[]): CloseStatus {
  if (!cells.some((cell) => cell.hasActivity)) return "empty";
  return cells.some((cell) => cell.backlogCount > 0) ? "open" : "closed";
}

export type YearSummary = { active: number; closed: number; open: number; taxCloseReady: boolean };

export function summarizeMonths(monthStatuses: CloseStatus[]): YearSummary {
  const active = monthStatuses.filter((status) => status !== "empty").length;
  const closed = monthStatuses.filter((status) => status === "closed").length;
  const open = monthStatuses.filter((status) => status === "open").length;
  // Ready only when there is activity and nothing is still open.
  return { active, closed, open, taxCloseReady: active > 0 && open === 0 };
}
