import { Suspense } from "react";
import Link from "next/link";
import { DashboardEntityCard } from "@/components/review/dashboard-entity-card";
import { DashboardTotalsStrip } from "@/components/review/dashboard-totals-strip";
import { DormantEntitiesCard } from "@/components/review/dormant-entities-card";
import { PeriodPicker } from "@/components/review/period-picker";
import { ReadinessSection } from "@/components/review/readiness-section";
import { SyncHealthCard } from "@/components/review/sync-health-card";
import { getAiPreclassifiedCount } from "@/lib/queries/ai-suggestions";
import {
  buildDashboardTotals,
  getPeriodCategorizationProgress,
  getReadinessSummary,
} from "@/lib/queries/dashboard";
import { getAllEntityHomeStats } from "@/lib/queries/entity-home";
import { getDormantEntities } from "@/lib/queries/review";
import { getSyncHealth } from "@/lib/queries/sync-health";
import { allTimePeriod, parsePeriodParams, periodQueryString } from "@/lib/period";

// The all-time default scans the full ledger plus one month-close matrix per active year.
export const maxDuration = 300;

type ReviewPageProps = {
  searchParams: Promise<{ month?: string; period?: string; at?: string }>;
};

export default async function ReviewPage({ searchParams }: ReviewPageProps) {
  const params = await searchParams;
  // "Current state of things": default to ALL TIME; the picker narrows, and every number and link
  // on this page follows the selected period.
  const period = parsePeriodParams(params, allTimePeriod());

  const [entityStats, progress, readiness, syncHealth, aiPreclassifiedCount, dormantEntities] =
    await Promise.all([
      getAllEntityHomeStats(period),
      getPeriodCategorizationProgress(period),
      getReadinessSummary(period),
      getSyncHealth(),
      getAiPreclassifiedCount(),
      getDormantEntities(),
    ]);

  const totals = buildDashboardTotals(entityStats);
  const periodQuery = periodQueryString(period);
  const progressPct =
    progress.total > 0 ? Math.round((100 * progress.categorized) / progress.total) : 0;
  const readyCount = entityStats.filter((s) => s.unclassifiedCount === 0).length;
  // Latest orphan-bearing year, for the alert's tax-close deep link.
  const orphanYear = readiness.openCells.reduce(
    (max, cell) => (cell.orphanCount > 0 ? Math.max(max, cell.year) : max),
    0,
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Classify · Dashboard
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">{period.label}</h1>
          <p className="text-sm text-muted-foreground">
            Where things stand · entity details in{" "}
            <Link href={`/review/entities?${periodQuery}`} className="text-primary hover:underline">
              Entities
            </Link>
            {" · "}
            analytics in{" "}
            <Link href={`/reports?${periodQuery}`} className="text-primary hover:underline">
              Reports
            </Link>
          </p>
        </div>
        <Suspense fallback={null}>
          <PeriodPicker period={period} />
        </Suspense>
      </div>

      <SyncHealthCard health={syncHealth} />

      {readiness.orphanTotal > 0 ? (
        <div className="rounded-lg border border-red-500/40 bg-red-500/5 px-4 py-3 text-sm">
          <span className="font-medium text-red-700 dark:text-red-400">
            {readiness.orphanTotal} transaction{readiness.orphanTotal === 1 ? "" : "s"} failed to book
          </span>{" "}
          <span className="text-muted-foreground">
            — no classification row (an import was interrupted). They keep months open until the
            import heal is re-run.
          </span>{" "}
          <Link
            href={`/tax-close${orphanYear > 0 ? `?year=${orphanYear}` : ""}`}
            className="font-medium text-primary hover:underline"
          >
            View in tax close →
          </Link>
        </div>
      ) : null}

      <DashboardTotalsStrip totals={totals} aiPreclassifiedCount={aiPreclassifiedCount} period={period} />

      <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Total transactions</h2>
            <p className="text-sm text-muted-foreground">Categorization progress · {period.label}</p>
          </div>
          <Link
            href={`/reports/classification-progress?${periodQuery}`}
            className="text-sm font-medium text-primary hover:underline"
          >
            Progress by entity →
          </Link>
        </div>

        <div className="mt-4">
          <div className="flex items-end justify-between gap-3">
            <p className="text-2xl font-semibold tabular-nums">
              {progress.total.toLocaleString()}{" "}
              <span className="text-base font-normal text-muted-foreground">
                transactions · {progress.categorized.toLocaleString()} categorized
              </span>
            </p>
            <p className="text-2xl font-semibold tabular-nums">{progressPct}%</p>
          </div>
          <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          {progress.total - progress.categorized > 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {(progress.total - progress.categorized).toLocaleString()} with no category yet — CPA-review
              (&ldquo;Ask My Accountant&rdquo;) rows count as categorized here but still appear in each
              entity&rsquo;s backlog below
            </p>
          ) : null}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Entities</h2>
            <p className="text-sm text-muted-foreground">
              {readyCount} of {entityStats.length} fully classified · {period.label}
            </p>
          </div>
          <Link
            href={`/review/entities?${periodQuery}`}
            className="text-sm font-medium text-primary hover:underline"
          >
            All entity cards →
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {entityStats.map((stats) => (
            <DashboardEntityCard key={stats.slug} stats={stats} period={period} />
          ))}
        </div>
      </section>

      <ReadinessSection readiness={readiness} periodLabel={period.label} />

      <DormantEntitiesCard entities={dormantEntities} />

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4 text-sm text-muted-foreground">
        <span>Looking for the old monthly view?</span>
        <Link href="/review/legacy" className="font-medium text-primary hover:underline">
          Legacy dashboard →
        </Link>
      </div>
    </div>
  );
}
