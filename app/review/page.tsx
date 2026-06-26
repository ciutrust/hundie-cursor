import { Suspense } from "react";
import Link from "next/link";
import { DormantEntitiesCard } from "@/components/review/dormant-entities-card";
import { PeriodPicker } from "@/components/review/period-picker";
import { ReviewKpiStrip } from "@/components/review/review-kpi-strip";
import { getDormantEntities, getReviewDashboardStats } from "@/lib/queries/review";
import { activeMonthPeriod, parsePeriodParams } from "@/lib/period";
import { formatCurrency } from "@/lib/utils";

type ReviewPageProps = {
  searchParams: Promise<{ month?: string; period?: string; at?: string }>;
};

export default async function ReviewPage({ searchParams }: ReviewPageProps) {
  const params = await searchParams;
  const period = parsePeriodParams(params, activeMonthPeriod());

  const [stats, dormantEntities] = await Promise.all([
    getReviewDashboardStats(period),
    getDormantEntities(),
  ]);

  const summaries = stats.summaries;
  const entities = summaries.filter((s) => s.slug !== "unclassified");

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Classify · Dashboard
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">{period.label}</h1>
          <p className="text-sm text-muted-foreground">
            Active month overview · entity details in{" "}
            <Link href="/review/entities" className="text-primary hover:underline">
              Entities
            </Link>
            {" · "}
            analytics in{" "}
            <Link href="/reports" className="text-primary hover:underline">
              Reports
            </Link>
          </p>
        </div>
        <Suspense fallback={null}>
          <PeriodPicker period={period} />
        </Suspense>
      </div>

      <ReviewKpiStrip stats={stats} />

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Entities this month</h2>
          <p className="text-sm text-muted-foreground">
            <Link href="/review/entities" className="text-primary hover:underline">
              View all entities (YTD cards) →
            </Link>
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {entities.map((summary) => (
            <Link
              key={summary.slug}
              href={`/review/${summary.slug}`}
              className="rounded-xl border border-border bg-card p-4 shadow-sm transition-colors hover:bg-muted/30"
            >
              <p className="font-medium">{summary.name}</p>
              <p className="mt-2 text-xl font-semibold tabular-nums">{formatCurrency(summary.total)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {summary.unclassifiedCount > 0
                  ? `${summary.unclassifiedCount} uncategorized`
                  : "All classified"}
              </p>
            </Link>
          ))}
        </div>
      </section>

      <DormantEntitiesCard entities={dormantEntities} />
    </div>
  );
}
