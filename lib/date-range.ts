/**
 * An arbitrary from/to window for the Transactions page.
 *
 * The rest of the app is preset-shaped (lib/period.ts: week/month/quarter/year), which can't express
 * "the days I was in Sacramento". The DB fetchers already take raw start/end, so this is a thin,
 * pure parser for `?from=&to=` — no PeriodRange involved.
 *
 * `end` is EXCLUSIVE (= to + 1 day) because every fetcher filters `.gte(start).lt(end)`; `to` stays
 * the inclusive day the user actually picked and sees.
 */
export type DateRange = {
  /** Inclusive first day the user picked (YYYY-MM-DD). */
  from: string;
  /** Inclusive last day the user picked (YYYY-MM-DD). */
  to: string;
  /** Inclusive start for queries (= from). */
  start: string;
  /** EXCLUSIVE end for queries (= to + 1 day). */
  end: string;
  label: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    ISO_DATE.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  );
}

/** The day after `iso`, in UTC. Turns an inclusive `to` into the exclusive `end` the fetchers want. */
export function nextDay(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** First day of `today`'s calendar month. */
export function startOfMonth(today: string): string {
  return `${today.slice(0, 7)}-01`;
}

function buildRange(from: string, to: string): DateRange {
  // A backwards window (user picked to < from) is a slip, not an error — swap rather than show zero rows.
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  return { from: lo, to: hi, start: lo, end: nextDay(hi), label: `${lo} → ${hi}` };
}

/** Default window when the URL carries no valid from/to: the current month so far. */
export function defaultDateRange(today: string): DateRange {
  return buildRange(startOfMonth(today), today);
}

/**
 * Parse `?from=&to=` into a concrete window. Falls back to the current month when either side is
 * missing or malformed, so a hand-edited URL can never render an empty/garbage page.
 */
export function parseDateRange(
  params: { from?: string | null; to?: string | null },
  today: string,
): DateRange {
  const from = isIsoDate(params.from) ? params.from : null;
  const to = isIsoDate(params.to) ? params.to : null;
  if (from && to) return buildRange(from, to);
  if (from && !to) return buildRange(from, today >= from ? today : from);
  if (!from && to) return buildRange(startOfMonth(to), to);
  return defaultDateRange(today);
}

/** Zero-padded expense report number for display: 1 -> "0001". */
export function formatExpenseReportNumber(value: number): string {
  return String(value).padStart(4, "0");
}
