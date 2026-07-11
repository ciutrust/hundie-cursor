// Lazy instance generation: given a bill's schedule + the latest instance that already exists,
// compute the missing due dates that SHOULD exist, up to and including the first cycle strictly after
// today (so the "current" cycle — possibly overdue — and the "next" cycle are always present). Pure:
// the DB wrapper (ensureBillInstances in lib/queries/bills.ts) reads the latest date, calls this, and
// upserts with onConflict:(bill_id,due_date)+ignoreDuplicates so concurrent page loads are race-safe.

import {
  addCadence,
  cadenceMonths,
  dueDateInMonth,
  mostRecentWeekday,
  parseIsoDate,
  type Cadence,
} from "./cadence";

export type BillDef = {
  id: string;
  entity_id: string;
  cadence: Cadence;
  due_day: number | null;
  anchor_date: string | null;
  expected_amount: number | null;
  status?: string;
};

export type DueInstanceRow = {
  bill_id: string;
  entity_id: string;
  due_date: string;
  expected_amount: number | null;
};

// A hard cap on how many instances one call can emit — a backstop against a bad schedule, never hit
// in normal use (a monthly bill emits at most 2 per load: current + next).
const DEFAULT_HORIZON = 24;

/** Advance one cycle while preserving the due_day anchor (so Feb 28 → Mar 31, not Mar 28). */
function nextDue(bill: BillDef, fromDueDate: string): string {
  if (bill.cadence === "weekly" || bill.cadence === "one_time") {
    return addCadence(fromDueDate, bill.cadence);
  }
  const months = cadenceMonths(bill.cadence);
  if (months === null) return addCadence(fromDueDate, bill.cadence);

  const from = parseIsoDate(fromDueDate);
  const effectiveDueDay = bill.due_day ?? from.getDate();
  const target = new Date(from.getFullYear(), from.getMonth() + months, 1);
  return dueDateInMonth(target.getFullYear(), target.getMonth(), effectiveDueDay);
}

/**
 * The stable day-of-month a monthly+ bill anchors on. Resolving it ONCE (from due_day, else the
 * anchor_date's day, else a fallback date's day) and threading it through generation is what keeps a
 * month-end bill from drifting: without this, nextDue re-reads the previous (already month-clamped)
 * cursor's day, so once Jan 31 clamps to Feb 28 the bill would stick on the 28th forever.
 */
function resolveMonthlyDueDay(bill: BillDef, fallbackDate: string): number {
  if (bill.due_day != null) return bill.due_day;
  if (bill.anchor_date) return parseIsoDate(bill.anchor_date).getDate();
  return parseIsoDate(fallbackDate).getDate();
}

/** A copy of the bill with a resolved, stable due_day for monthly+ cadences (weekly/one_time unchanged). */
function withStableDueDay(bill: BillDef, fallbackDate: string): BillDef {
  if (bill.cadence === "weekly" || bill.cadence === "one_time") return bill;
  return { ...bill, due_day: resolveMonthlyDueDay(bill, fallbackDate) };
}

/** The first date of the schedule to anchor from, before rolling to the current cycle. */
function initialBase(bill: BillDef, today: string): string {
  if (bill.anchor_date) return bill.anchor_date;

  const now = parseIsoDate(today);
  if (bill.cadence === "weekly") {
    return bill.due_day == null ? today : mostRecentWeekday(today, bill.due_day);
  }
  // monthly+ with no anchor: this month's due_day (falls back to today's day-of-month).
  const effectiveDueDay = bill.due_day ?? now.getDate();
  return dueDateInMonth(now.getFullYear(), now.getMonth(), effectiveDueDay);
}

/** Largest sequence date on-or-before today; or the base itself when the schedule starts later. */
function seedFirstDue(bill: BillDef, today: string): string {
  let cursor = initialBase(bill, today);
  if (cursor > today) return cursor; // schedule hasn't started — first instance is upcoming
  while (nextDue(bill, cursor) <= today) {
    cursor = nextDue(bill, cursor);
  }
  return cursor;
}

/**
 * The single next cycle after a given due date — used when confirming a payment to advance the bill
 * deterministically (independent of "today", unlike computeDueInstances). Null for one_time bills and
 * non-active bills (a paused/archived bill is frozen and does not roll forward).
 */
export function computeNextInstance(bill: BillDef, afterDueDate: string): DueInstanceRow | null {
  if (bill.cadence === "one_time") return null;
  if (bill.status && bill.status !== "active") return null;
  const resolved = withStableDueDay(bill, afterDueDate);
  return {
    bill_id: bill.id,
    entity_id: bill.entity_id,
    due_date: nextDue(resolved, afterDueDate),
    expected_amount: bill.expected_amount,
  };
}

export function computeDueInstances(input: {
  bill: BillDef;
  latestDueDate: string | null;
  today: string;
  horizon?: number;
}): DueInstanceRow[] {
  const { bill, latestDueDate, today } = input;
  const horizon = input.horizon ?? DEFAULT_HORIZON;

  // Only active bills roll forward; paused/archived are shown but frozen.
  if (bill.status && bill.status !== "active") return [];

  const rows: DueInstanceRow[] = [];
  const push = (due_date: string) => {
    rows.push({
      bill_id: bill.id,
      entity_id: bill.entity_id,
      due_date,
      expected_amount: bill.expected_amount,
    });
  };

  if (bill.cadence === "one_time") {
    if (latestDueDate) return [];
    push(bill.anchor_date ?? today);
    return rows;
  }

  // Resolve a stable monthly anchor day ONCE so month-end bills don't drift (see withStableDueDay).
  const resolved = withStableDueDay(bill, today);

  let cursor: string;
  if (latestDueDate) {
    // If the newest instance is already in the future, the current + next cycles both exist.
    if (latestDueDate > today) return [];
    cursor = nextDue(resolved, latestDueDate);
  } else {
    cursor = seedFirstDue(resolved, today);
  }

  for (let i = 0; i < horizon; i++) {
    push(cursor);
    if (cursor > today) break; // we've now emitted the first cycle after today (the "next")
    cursor = nextDue(resolved, cursor);
  }

  return rows;
}
