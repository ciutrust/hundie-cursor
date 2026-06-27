import { Suspense } from "react";
import Link from "next/link";
import { DormantEntitiesCard } from "@/components/review/dormant-entities-card";
import { PeriodPicker } from "@/components/review/period-picker";
import { ReviewKpiStrip } from "@/components/review/review-kpi-strip";
import { getCategorizationProgress, getDormantEntities, getReviewDashboardStats } from "@/lib/queries/review";
import { activeMonthPeriod, parsePeriodParams } from "@/lib/period";
import { formatCurrency } from "@/lib/utils";

type ReviewPageProps = {
  searchParams: Promise<{ month?: string; period?: string; at?: string }>;
};

export default async function ReviewPage({ searchParams }: ReviewPageProps) {
  const params = await searchParams;
  const period = parsePeriodParams(params, activeMonthPeriod());

  const [stats, dormantEntities, progress] = await Promise.all([
    getReviewDashboardStats(period),
    getDormantEntities(),
    getCategorizationProgress(),
  ]);

  const summaries = stats.summaries;
  const entities = summaries.filter((s) => s.slug !== "unclassified");
  const progressPct = progress.total > 0 ? Math.round((100 * progress.categorized) / progress.total) : 0;
  const aiRatePct = progress.aiAcceptRate != null ? Math.round(progress.aiAcceptRate * 100) : null;

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

      <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Categorization progress</h2>
            <p className="text-sm text-muted-foreground">All transactions, all time</p>
          </div>
          <Link href="/reports/ai-suggestions" className="text-sm font-medium text-primary hover:underline">
            AI suggestion report →
          </Link>
        </div>

        <div className="mt-4">
          <div className="flex items-end justify-between gap-3">
            <p className="text-2xl font-semibold tabular-nums">
              {progress.categorized.toLocaleString()}{" "}
              <span className="text-base font-normal text-muted-foreground">
                / {progress.total.toLocaleString()} categorized
              </span>
            </p>
            <p className="text-2xl font-semibold tabular-nums">{progressPct}%</p>
          </div>
          <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progressPct}%` }} />
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Link
            href="/reports/ai-suggestions"
            className="rounded-lg border border-border bg-muted/30 p-3 transition-colors hover:bg-muted/50"
          >
            <p className="text-xs text-muted-foreground">Accepted from AI</p>
            <p className="text-xl font-semibold tabular-nums text-violet-600 dark:text-violet-400">
              {progress.aiAccepted.toLocaleString()}
            </p>
          </Link>
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">AI accept rate</p>
            <p className="text-xl font-semibold tabular-nums">{aiRatePct != null ? `${aiRatePct}%` : "—"}</p>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">From the engine</p>
            <p className="text-xl font-semibold tabular-nums">{progress.deterministicAccepted.toLocaleString()}</p>
          </div>
        </div>
      </section>

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
            <div
              key={summary.slug}
              className="rounded-xl border border-border bg-card p-4 shadow-sm"
            >
              <Link href={`/review/${summary.slug}`} className="block transition-opacity hover:opacity-80">
                <p className="font-medium">{summary.name}</p>
                <p className="mt-2 text-2xl font-semibold tabular-nums">{formatCurrency(summary.total)}</p>
                <p className="text-xs text-muted-foreground">expenses</p>
              </Link>
              <div className="mt-3 space-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
                <Link
                  href={`/reports/category-breakdown?entity=${summary.slug}`}
                  className="flex items-center justify-between hover:text-foreground hover:underline"
                >
                  <span>Gross spend</span>
                  <span className="tabular-nums">{formatCurrency(summary.grossTotal)}</span>
                </Link>
                {summary.excludedTotal > 0 ? (
                  <Link
                    href={`/reports/category-breakdown?entity=${summary.slug}`}
                    className="flex items-center justify-between hover:text-foreground hover:underline"
                  >
                    <span>Excluded</span>
                    <span className="tabular-nums">{formatCurrency(summary.excludedTotal)}</span>
                  </Link>
                ) : null}
                {summary.unclassifiedTotal > 0 ? (
                  <Link
                    href={`/review/${summary.slug}/uncategorized`}
                    className="flex items-center justify-between font-medium text-amber-600 hover:underline dark:text-amber-400"
                  >
                    <span>To classify ({summary.unclassifiedCount})</span>
                    <span className="tabular-nums">{formatCurrency(summary.unclassifiedTotal)}</span>
                  </Link>
                ) : (
                  <div className="flex items-center justify-between text-primary">
                    <span>All classified</span>
                    <span>✓</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <DormantEntitiesCard entities={dormantEntities} />
    </div>
  );
}
