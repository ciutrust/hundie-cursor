import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PeriodTrendBadge } from "@/components/review/period-trend-badge";
import type { PeriodRange } from "@/lib/period";
import { periodQueryString } from "@/lib/period";
import type { EntitySummary } from "@/lib/types/database";
import { cn, formatCurrency } from "@/lib/utils";

type EntitySummaryGridProps = {
  summaries: EntitySummary[];
  period: PeriodRange;
};

export function EntitySummaryGrid({ summaries, period }: EntitySummaryGridProps) {
  const query = periodQueryString(period);

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {summaries.map((summary) => {
        const isUnclassified = summary.slug === "unclassified";
        const href = `/review/${summary.slug}?${query}`;

        return (
          <Link key={summary.slug} href={href} className="group block">
            <Card
              className={cn(
                "border-border/80 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md",
                isUnclassified && summary.unclassifiedCount > 0 && "border-destructive/30 ring-1 ring-destructive/10",
              )}
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-medium">{summary.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <p className="text-2xl font-semibold tracking-tight">{formatCurrency(summary.total)}</p>
                  <PeriodTrendBadge current={summary.total} compareTo={summary.previousMonthTotal} />
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {isUnclassified
                    ? `${summary.transactionCount} need review · goal $0`
                    : `${summary.transactionCount} transactions`}
                  {!isUnclassified && summary.unclassifiedCount > 0
                    ? ` · ${summary.unclassifiedCount} need category`
                    : null}
                </p>
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
