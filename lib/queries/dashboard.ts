import type { PeriodRange } from "@/lib/period";
import { cellStatus } from "@/lib/month-close";
import { createClient } from "@/lib/supabase/server";
import { getMonthCloseMatrix, type MonthCloseEntityRow } from "@/lib/queries/review";
import type { EntityHomeStats } from "@/lib/queries/entity-home";

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

export type PeriodProgress = {
  total: number;
  categorized: number;
};

/**
 * The dashboard's "total transactions bar", scoped to the selected period.
 *
 * Same semantics as the all-time getCategorizationProgress bar: categorized = category_id NOT NULL,
 * so an "Ask My Accountant" row counts as categorized HERE while the entity cards/readiness count it
 * as backlog — the bar answers "how much has a category at all", the cards answer "what still needs
 * my review". For type "all" the filters are omitted entirely so the numbers are byte-identical to
 * the legacy all-time bar.
 */
export async function getPeriodCategorizationProgress(period: PeriodRange): Promise<PeriodProgress> {
  const supabase = await createClient();

  const base = () => {
    if (period.type === "all") {
      return supabase.from("classifications").select("id", { count: "exact", head: true });
    }
    return supabase
      .from("classifications")
      .select("id, transaction:transactions!inner(transaction_date)", { count: "exact", head: true })
      .gte("transaction.transaction_date", period.start)
      .lt("transaction.transaction_date", period.end);
  };

  const [totalRes, categorizedRes] = await Promise.all([
    base(),
    base().not("category_id", "is", null),
  ]);

  if (totalRes.error) throw totalRes.error;
  if (categorizedRes.error) throw categorizedRes.error;

  return { total: totalRes.count ?? 0, categorized: categorizedRes.count ?? 0 };
}

export type OpenMonthCell = {
  entitySlug: string;
  entityName: string;
  year: number;
  month: number;
  backlogCount: number;
  orphanCount: number;
};

export type ReadinessSummary = {
  /** Every OPEN (entity, month) cell inside the period — year asc, month asc, entity display order. */
  openCells: OpenMonthCell[];
  /** Failed-to-book transactions across those cells (orphans always keep their cell open). */
  orphanTotal: number;
  /** Distinct (year, month) pairs with at least one open cell. */
  openMonthCount: number;
};

/** Does the calendar month overlap [period.start, period.end)? ISO string compare, end-exclusive. */
export function monthIntersectsPeriod(
  year: number,
  month: number,
  period: Pick<PeriodRange, "start" | "end">,
): boolean {
  const monthStart = `${year}-${pad2(month)}-01`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const monthEnd = `${nextYear}-${pad2(nextMonth)}-01`;
  return monthStart < period.end && monthEnd > period.start;
}

/**
 * Calendar years the period touches, clamped to the ledger's actual span so "all time" (1970..)
 * doesn't fan out into decades of empty getMonthCloseMatrix scans.
 */
export function yearsForPeriod(
  period: Pick<PeriodRange, "start" | "end">,
  bounds: { minYear: number; maxYear: number },
): number[] {
  const startYear = Math.max(Number(period.start.slice(0, 4)), bounds.minYear);
  // end is exclusive: a period ending exactly on Jan 1 doesn't touch that year.
  const rawEndYear = Number(period.end.slice(0, 4)) - (period.end.slice(5) === "01-01" ? 1 : 0);
  const endYear = Math.min(rawEndYear, bounds.maxYear);
  const years: number[] = [];
  for (let year = startYear; year <= endYear; year += 1) years.push(year);
  return years;
}

/**
 * Flatten per-year month-close matrices into the period's open (entity, month) cells.
 * Readiness is month-granular by design: a week/quarter period includes every month it touches.
 * The "__unassigned__" pseudo-row (orphans on accounts with no default entity) is INCLUDED — the
 * UI must render it without an entity link, per the tax-close convention.
 */
export function buildReadinessSummary(
  matrices: Array<{ year: number; rows: MonthCloseEntityRow[] }>,
  period: Pick<PeriodRange, "start" | "end">,
): ReadinessSummary {
  const openCells: OpenMonthCell[] = [];
  const openMonths = new Set<string>();
  let orphanTotal = 0;

  for (const { year, rows } of [...matrices].sort((a, b) => a.year - b.year)) {
    for (let month = 1; month <= 12; month += 1) {
      if (!monthIntersectsPeriod(year, month, period)) continue;
      for (const row of rows) {
        const cell = row.months[month];
        if (!cell || cellStatus(cell) !== "open") continue;
        openCells.push({
          entitySlug: row.slug,
          entityName: row.name,
          year,
          month,
          backlogCount: cell.backlogCount,
          orphanCount: cell.orphanCount,
        });
        openMonths.add(`${year}-${pad2(month)}`);
        orphanTotal += cell.orphanCount;
      }
    }
  }

  return { openCells, orphanTotal, openMonthCount: openMonths.size };
}

/** First/last calendar year with a live (non-Plaid-removed) transaction; null when the ledger is empty. */
export async function getLedgerYearBounds(): Promise<{ minYear: number; maxYear: number } | null> {
  const supabase = await createClient();

  const bound = (ascending: boolean) =>
    supabase
      .from("transactions")
      .select("transaction_date")
      .is("plaid_removed_at", null)
      .order("transaction_date", { ascending })
      .limit(1)
      .maybeSingle();

  const [minRes, maxRes] = await Promise.all([bound(true), bound(false)]);
  if (minRes.error) throw minRes.error;
  if (maxRes.error) throw maxRes.error;
  if (!minRes.data || !maxRes.data) return null;

  return {
    minYear: Number(minRes.data.transaction_date.slice(0, 4)),
    maxYear: Number(maxRes.data.transaction_date.slice(0, 4)),
  };
}

/** Which entity/months in the period are not ready (open backlog or failed-to-book orphans). */
export async function getReadinessSummary(period: PeriodRange): Promise<ReadinessSummary> {
  const empty: ReadinessSummary = { openCells: [], orphanTotal: 0, openMonthCount: 0 };

  const bounds = await getLedgerYearBounds();
  if (!bounds) return empty;

  const years = yearsForPeriod(period, bounds);
  if (years.length === 0) return empty;

  const matrices = await Promise.all(
    years.map(async (year) => ({ year, rows: await getMonthCloseMatrix(year) })),
  );

  return buildReadinessSummary(matrices, period);
}

export type DashboardTotals = {
  incomeTotal: number;
  expenseTotal: number;
  netTotal: number;
  unclassifiedCount: number;
  unclassifiedTotal: number;
  unclassifiedExpenseCount: number;
  unclassifiedExpenseTotal: number;
  unclassifiedIncomeCount: number;
  unclassifiedIncomeTotal: number;
};

/**
 * Roll the per-entity stats up into the dashboard header strip.
 * NOTE: EntityHomeStats.unclassifiedTotal carries only the EXPENSE-side dollars (its historical
 * meaning), so the combined "to classify $" here is expense$ + income$ summed explicitly.
 */
export function buildDashboardTotals(stats: EntityHomeStats[]): DashboardTotals {
  const totals: DashboardTotals = {
    incomeTotal: 0,
    expenseTotal: 0,
    netTotal: 0,
    unclassifiedCount: 0,
    unclassifiedTotal: 0,
    unclassifiedExpenseCount: 0,
    unclassifiedExpenseTotal: 0,
    unclassifiedIncomeCount: 0,
    unclassifiedIncomeTotal: 0,
  };

  for (const s of stats) {
    totals.incomeTotal += s.incomeTotal;
    totals.expenseTotal += s.expenseTotal;
    totals.unclassifiedCount += s.unclassifiedCount;
    totals.unclassifiedExpenseCount += s.unclassifiedExpenseCount;
    totals.unclassifiedExpenseTotal += s.unclassifiedExpenseTotal;
    totals.unclassifiedIncomeCount += s.unclassifiedIncomeCount;
    totals.unclassifiedIncomeTotal += s.unclassifiedIncomeTotal;
    totals.unclassifiedTotal += s.unclassifiedExpenseTotal + s.unclassifiedIncomeTotal;
  }
  totals.netTotal = totals.incomeTotal - totals.expenseTotal;

  return totals;
}
