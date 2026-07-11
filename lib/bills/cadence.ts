// Cadence + local-date math for bills. Pure, timezone-safe (everything is built from local Date
// parts the same way lib/period.ts does), and every function that needs "now" takes `today` as an
// ISO string so tests can pin it and the generator / state-deriver / match windows never disagree.

export type Cadence = "weekly" | "monthly" | "quarterly" | "semiannual" | "annual" | "one_time";

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** Local-date ISO (YYYY-MM-DD), matching lib/period.ts's toIsoDate. */
export function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Today as YYYY-MM-DD in local time. THE single source of truth for "today" across bills. */
export function todayIso(): string {
  return toIsoDate(new Date());
}

/** Parse a YYYY-MM-DD string into a local Date (no UTC drift). */
export function parseIsoDate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** Whole-day difference `a - b` (positive when `a` is later than `b`). */
export function daysBetween(a: string, b: string): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((parseIsoDate(a).getTime() - parseIsoDate(b).getTime()) / MS_PER_DAY);
}

/** Months per cycle for month-anchored cadences; null for weekly / one_time. */
export function cadenceMonths(cadence: Cadence): number | null {
  switch (cadence) {
    case "monthly":
      return 1;
    case "quarterly":
      return 3;
    case "semiannual":
      return 6;
    case "annual":
      return 12;
    default:
      return null; // weekly, one_time
  }
}

/** A day-of-month clamped to a real day in the given year/month (e.g. 31 → 28/29 in Feb). */
export function dueDateInMonth(year: number, month0: number, dueDay: number): string {
  const daysInMonth = new Date(year, month0 + 1, 0).getDate();
  const day = Math.min(Math.max(Math.trunc(dueDay), 1), daysInMonth);
  return `${year}-${pad2(month0 + 1)}-${pad2(day)}`;
}

/** The most recent date on-or-before `fromIso` that falls on the given weekday (0=Sun..6=Sat). */
export function mostRecentWeekday(fromIso: string, weekday: number): string {
  const normalized = ((weekday % 7) + 7) % 7;
  const date = parseIsoDate(fromIso);
  const daysBack = (date.getDay() - normalized + 7) % 7;
  date.setDate(date.getDate() - daysBack);
  return toIsoDate(date);
}

/**
 * Advance one cycle from an ISO due date. weekly = +7 days; monthly+ preserve the day-of-month
 * (clamped to the target month's length); one_time returns the same date. Note the generator
 * anchors monthly+ cycles on the bill's due_day rather than chaining this, so month-end clamping
 * never drifts (Jan 31 → Feb 28 → Mar 31, not Mar 28).
 */
export function addCadence(dueDate: string, cadence: Cadence): string {
  if (cadence === "one_time") return dueDate;

  if (cadence === "weekly") {
    const date = parseIsoDate(dueDate);
    date.setDate(date.getDate() + 7);
    return toIsoDate(date);
  }

  const months = cadenceMonths(cadence);
  if (months === null) return dueDate;

  const date = parseIsoDate(dueDate);
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  return dueDateInMonth(target.getFullYear(), target.getMonth(), date.getDate());
}
