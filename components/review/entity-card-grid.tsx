import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { ENTITY_ACCENT_STYLES, getEntityDisplay } from "@/lib/entities/display";
import type { PeriodRange } from "@/lib/period";
import { periodQueryString } from "@/lib/period";
import type { EntitySummary } from "@/lib/types/database";
import { cn, formatCurrency } from "@/lib/utils";

type EntityCardGridProps = {
  summaries: EntitySummary[];
  period: PeriodRange;
};

export function EntityCardGrid({ summaries, period }: EntityCardGridProps) {
  const query = periodQueryString(period);
  const entities = summaries
    .filter((summary) => summary.slug !== "unclassified")
    .sort((a, b) => b.unclassifiedCount - a.unclassifiedCount || b.total - a.total);

  const topBacklog = entities.find((entity) => entity.unclassifiedCount > 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Entities</h2>
          <p className="text-sm text-muted-foreground">Click an entity to drill into its transactions</p>
        </div>
        <p className="text-xs text-muted-foreground">Sorted by unclassified</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {entities.map((summary) => {
          const meta = getEntityDisplay(summary.slug);
          const styles = ENTITY_ACCENT_STYLES[meta.accent];
          const href = `/review/${summary.slug}?${query}`;
          const isReady = summary.unclassifiedCount === 0;
          const classifiedCount = Math.max(summary.transactionCount - summary.unclassifiedCount, 0);
          const progress =
            summary.transactionCount > 0
              ? Math.round((classifiedCount / summary.transactionCount) * 100)
              : 100;
          const reviewPct = 100 - progress;

          return (
            <Link key={summary.slug} href={href} className="group block">
              <article
                className={cn(
                  "relative overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-all",
                  "hover:-translate-y-0.5 hover:border-border/80 hover:shadow-md",
                  "border-t-[3px]",
                  styles.border,
                  styles.glow,
                )}
              >
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate font-semibold">{summary.name}</h3>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{meta.subtitle}</p>
                    </div>
                    {isReady ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="h-3 w-3" />
                        ready
                      </span>
                    ) : (
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums",
                          styles.badge,
                        )}
                      >
                        {summary.unclassifiedCount} left
                      </span>
                    )}
                  </div>

                  <p className="mt-4 text-2xl font-semibold tabular-nums tracking-tight">
                    {formatCurrency(summary.total)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {summary.transactionCount.toLocaleString()} transactions this period
                  </p>
                </div>

                <div className="px-4 pb-4">
                  <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="bg-emerald-500 transition-all" style={{ width: `${progress}%` }} />
                    {reviewPct > 0 ? (
                      <div className={styles.bar} style={{ width: `${reviewPct}%` }} />
                    ) : null}
                  </div>
                </div>
              </article>
            </Link>
          );
        })}
      </div>

      {topBacklog ? (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{topBacklog.name.split(",")[0]}</span> has the most
          backlog — start there.
        </p>
      ) : null}
    </div>
  );
}
