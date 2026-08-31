import Link from "next/link";
import type { DashboardTotals } from "@/lib/queries/dashboard";
import { periodQueryString, type PeriodRange } from "@/lib/period";
import { cn, formatCurrency } from "@/lib/utils";

type DashboardTotalsStripProps = {
  totals: DashboardTotals;
  aiPreclassifiedCount: number;
  period: PeriodRange;
};

function Tile({
  dot,
  label,
  children,
}: {
  dot: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <span className={cn("h-2 w-2 rounded-full", dot)} />
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
      </div>
      {children}
    </div>
  );
}

/** Period-scoped header totals for the dashboard (every number follows the time filter). */
export function DashboardTotalsStrip({ totals, aiPreclassifiedCount, period }: DashboardTotalsStripProps) {
  const periodQuery = periodQueryString(period);
  const netPositive = totals.netTotal >= 0;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <Tile dot={netPositive ? "bg-emerald-500" : "bg-red-500"} label="Net P&L · all entities">
        <span
          className={cn(
            "text-2xl font-semibold tabular-nums tracking-tight",
            netPositive ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400",
          )}
        >
          {formatCurrency(totals.netTotal)}
        </span>
        <p className="mt-1 text-xs text-muted-foreground">income − expenses</p>
      </Tile>

      <Tile dot="bg-emerald-500" label="Income">
        <span className="text-2xl font-semibold tabular-nums tracking-tight">
          {formatCurrency(totals.incomeTotal)}
        </span>
        <p className="mt-1 text-xs text-muted-foreground">operating income, all entities</p>
      </Tile>

      <Tile dot="bg-sky-500" label="Expenses">
        <span className="text-2xl font-semibold tabular-nums tracking-tight">
          {formatCurrency(totals.expenseTotal)}
        </span>
        <p className="mt-1 text-xs text-muted-foreground">booked operating expenses</p>
      </Tile>

      <Tile dot="bg-amber-500" label="To classify">
        <Link href={`/review/entities?${periodQuery}`} className="group block">
          <span className="text-2xl font-semibold tabular-nums tracking-tight text-amber-600 group-hover:underline dark:text-amber-400">
            {totals.unclassifiedCount.toLocaleString()}
          </span>
          <p className="mt-1 text-xs text-muted-foreground">
            {totals.unclassifiedCount > 0
              ? `${formatCurrency(totals.unclassifiedTotal)} · ${totals.unclassifiedExpenseCount.toLocaleString()} expense · ${totals.unclassifiedIncomeCount.toLocaleString()} income`
              : "nothing waiting"}
          </p>
        </Link>
      </Tile>

      <Tile dot="bg-violet-500" label="AI pre-classified">
        <Link href="/review/ai" className="group block">
          <span className="text-2xl font-semibold tabular-nums tracking-tight text-violet-600 group-hover:underline dark:text-violet-400">
            {aiPreclassifiedCount.toLocaleString()}
          </span>
          <p className="mt-1 text-xs text-muted-foreground">awaiting your confirm · open AI review</p>
        </Link>
      </Tile>
    </div>
  );
}
