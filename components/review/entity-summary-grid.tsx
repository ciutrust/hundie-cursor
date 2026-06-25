import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MonthTrendIndicator } from "@/components/review/month-trend-indicator";
import type { EntitySummary } from "@/lib/types/database";
import { cn, formatCurrency } from "@/lib/utils";

type EntitySummaryGridProps = {
  summaries: EntitySummary[];
  month: string;
};

export function EntitySummaryGrid({ summaries, month }: EntitySummaryGridProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {summaries.map((summary) => {
        const isUnclassified = summary.slug === "unclassified";
        const href = `/review/${summary.slug}?month=${month}`;

        return (
          <Link key={summary.slug} href={href} className="group block">
            <Card
              className={cn(
                "transition-shadow hover:shadow-md",
                isUnclassified && summary.unclassifiedCount > 0 && "border-destructive/40",
              )}
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{summary.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <p className="text-2xl font-semibold">{formatCurrency(summary.total)}</p>
                  <MonthTrendIndicator
                    current={summary.total}
                    compareTo={summary.previousMonthTotal}
                    label="last month"
                  />
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {summary.transactionCount} transaction{summary.transactionCount === 1 ? "" : "s"}
                  {summary.unclassifiedCount > 0 && !isUnclassified
                    ? ` · ${summary.unclassifiedCount} uncategorized`
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
