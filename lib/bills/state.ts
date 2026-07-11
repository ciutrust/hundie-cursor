// Derive a bill instance's display state from its stored status + due date vs today. "due_soon" and
// "overdue" are intentionally NOT stored (they change with the calendar) — they are computed here so
// the dashboard, badges, and totals all agree. Badge colors live in the component, not here.

import { daysBetween } from "./cadence";

export type InstanceStatus = "open" | "paid" | "skipped";
export type BillState = "paid" | "skipped" | "overdue" | "due_soon" | "upcoming";

export const DEFAULT_DUE_SOON_DAYS = 7;

export function deriveBillState(input: {
  dueDate: string;
  status: InstanceStatus;
  today: string;
  dueSoonDays?: number;
}): BillState {
  if (input.status === "paid") return "paid";
  if (input.status === "skipped") return "skipped";

  const dueSoonDays = input.dueSoonDays ?? DEFAULT_DUE_SOON_DAYS;
  const daysUntilDue = daysBetween(input.dueDate, input.today);

  if (daysUntilDue < 0) return "overdue";
  if (daysUntilDue <= dueSoonDays) return "due_soon";
  return "upcoming";
}

/** True for states that still owe money (used for per-entity "amount due" totals). */
export function isOutstanding(state: BillState): boolean {
  return state === "overdue" || state === "due_soon" || state === "upcoming";
}
