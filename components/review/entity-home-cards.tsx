import Link from "next/link";
import { ENTITY_ACCENT_STYLES, getEntityDisplay } from "@/lib/entities/display";
import type { EntityHomeStats } from "@/lib/queries/entity-home";
import type { PeriodRange } from "@/lib/period";
import { periodQueryString } from "@/lib/period";
import { cn, formatCurrency } from "@/lib/utils";

type EntityHomeCardsProps = {
  stats: EntityHomeStats;
  period: PeriodRange;
  reportsEntityHref?: string;
};

export function EntityHomeCards({ stats, period, reportsEntityHref }: EntityHomeCardsProps) {
  const meta = getEntityDisplay(stats.slug);
  const styles = ENTITY_ACCENT_STYLES[meta.accent];
  const periodQuery = periodQueryString(period);
  const uncategorizedHref = `/review/${stats.slug}/uncategorized?${periodQuery}`;
  const reportsHref =
    reportsEntityHref ?? `/reports/transactions?entity=${stats.slug}&${periodQuery}`;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{stats.name}</h2>
          <p className="text-sm text-muted-foreground">{meta.subtitle}</p>
        </div>
        <Link
          href={`/review/${stats.slug}?${periodQuery}`}
          className="text-xs font-medium text-primary hover:underline"
        >
          Entity home →
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Link
          href={reportsHref}
          className={cn(
            "rounded-xl border border-border bg-card p-4 shadow-sm transition-colors hover:bg-muted/30",
            "border-t-[3px]",
            styles.border,
          )}
        >
          <p className="text-xs font-medium text-muted-foreground">Expenses · {period.label}</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{formatCurrency(stats.expenseTotal)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {stats.transactionCount.toLocaleString()} transactions · view in reports
          </p>
        </Link>

        <Link
          href={uncategorizedHref}
          className={cn(
            "rounded-xl border border-border bg-card p-4 shadow-sm transition-colors hover:bg-muted/30",
            stats.unclassifiedCount > 0 ? "border-t-[3px] border-t-destructive" : "border-t-[3px]",
            stats.unclassifiedCount > 0 ? undefined : styles.border,
          )}
        >
          <p className="text-xs font-medium text-muted-foreground">Uncategorized · {period.label}</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">
            {stats.unclassifiedCount.toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {stats.unclassifiedCount > 0
              ? `${formatCurrency(stats.unclassifiedTotal)} to classify →`
              : "All classified"}
          </p>
        </Link>

        <div
          className={cn(
            "rounded-xl border border-border bg-card p-4 shadow-sm",
            "border-t-[3px]",
            styles.border,
          )}
        >
          <p className="text-xs font-medium text-muted-foreground">Top category · {period.label}</p>
          {stats.topCategory ? (
            <>
              <p className="mt-2 truncate text-lg font-semibold">{stats.topCategory.name}</p>
              <p className="mt-1 text-sm tabular-nums text-muted-foreground">
                {formatCurrency(stats.topCategory.total)}
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">No categorized expenses yet</p>
          )}
        </div>
      </div>
    </section>
  );
}
