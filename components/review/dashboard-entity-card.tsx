import Link from "next/link";
import { ENTITY_ACCENT_STYLES, getEntityDisplay } from "@/lib/entities/display";
import type { EntityHomeStats } from "@/lib/queries/entity-home";
import { periodQueryString, type PeriodRange } from "@/lib/period";
import { cn, formatCurrency } from "@/lib/utils";

type DashboardEntityCardProps = {
  stats: EntityHomeStats;
  period: PeriodRange;
};

/**
 * One entity's current state for the selected period: net P&L + revenue, top expense categories,
 * and what still needs classification (split expense/income, deep-linked to the worklists).
 */
export function DashboardEntityCard({ stats, period }: DashboardEntityCardProps) {
  const meta = getEntityDisplay(stats.slug);
  const styles = ENTITY_ACCENT_STYLES[meta.accent];
  const periodQuery = periodQueryString(period);
  // Worklist contract: OMIT flow for the expense tab; only the literal flow=income switches tabs.
  const expenseBacklogHref = `/review/${stats.slug}/uncategorized?${periodQuery}`;
  const incomeBacklogHref = `/review/${stats.slug}/uncategorized?${periodQueryString(period, { flow: "income" })}`;
  const hasBacklog = stats.unclassifiedCount > 0;
  const backlogTotal = stats.unclassifiedExpenseTotal + stats.unclassifiedIncomeTotal;
  const netPositive = stats.netTotal >= 0;

  return (
    <div
      className={cn(
        "flex flex-col rounded-xl border border-border bg-card p-4 shadow-sm",
        "border-t-[3px]",
        hasBacklog ? "border-t-destructive" : styles.border,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/review/${stats.slug}?${periodQuery}`} className="font-semibold hover:underline">
            {stats.name}
          </Link>
          <p className="truncate text-xs text-muted-foreground">{meta.subtitle}</p>
        </div>
        <Link
          href={`/review/${stats.slug}?${periodQuery}`}
          className="shrink-0 text-xs font-medium text-primary hover:underline"
        >
          Entity home →
        </Link>
      </div>

      <p
        className={cn(
          "mt-3 text-2xl font-semibold tabular-nums",
          netPositive ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400",
        )}
      >
        {formatCurrency(stats.netTotal)}
      </p>
      <p className="text-xs text-muted-foreground">
        net · income <span className="tabular-nums">{formatCurrency(stats.incomeTotal)}</span> · expenses{" "}
        <span className="tabular-nums">{formatCurrency(stats.expenseTotal)}</span>
      </p>

      <div className="mt-3 space-y-1 border-t border-border pt-2">
        <p className="text-xs font-medium text-muted-foreground">Top expenses</p>
        {stats.topCategories.length > 0 ? (
          stats.topCategories.map((category) => (
            <Link
              key={category.name}
              href={`/reports/category-breakdown?entity=${stats.slug}&${periodQuery}`}
              className="flex items-center justify-between gap-3 text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              <span className="truncate">{category.name}</span>
              <span className="shrink-0 tabular-nums">{formatCurrency(category.total)}</span>
            </Link>
          ))
        ) : (
          <p className="text-xs text-muted-foreground">No categorized expenses yet</p>
        )}
      </div>

      <div className="mt-auto space-y-1 border-t border-border pt-2 text-xs">
        {hasBacklog ? (
          <>
            <Link
              href={expenseBacklogHref}
              className="flex items-center justify-between gap-3 font-medium text-amber-600 hover:underline dark:text-amber-400"
            >
              <span>Expenses to classify ({stats.unclassifiedExpenseCount.toLocaleString()})</span>
              <span className="tabular-nums">{formatCurrency(stats.unclassifiedExpenseTotal)}</span>
            </Link>
            <Link
              href={incomeBacklogHref}
              className="flex items-center justify-between gap-3 font-medium text-amber-600 hover:underline dark:text-amber-400"
            >
              <span>Income to classify ({stats.unclassifiedIncomeCount.toLocaleString()})</span>
              <span className="tabular-nums">{formatCurrency(stats.unclassifiedIncomeTotal)}</span>
            </Link>
            <div className="flex items-center justify-between gap-3 font-semibold text-foreground">
              <span>Total to classify ({stats.unclassifiedCount.toLocaleString()})</span>
              <span className="tabular-nums">{formatCurrency(backlogTotal)}</span>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between font-medium text-primary">
            <span>All classified</span>
            <span>✓</span>
          </div>
        )}
      </div>
    </div>
  );
}
