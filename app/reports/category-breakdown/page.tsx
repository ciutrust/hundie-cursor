import { Suspense } from "react";
import { notFound } from "next/navigation";
import { CategoryBreakdown } from "@/components/review/category-breakdown";
import { ReportFilters } from "@/components/reports/report-filters";
import { parseReportEntitySlug, parseReportPeriod } from "@/lib/reports/report-params";
import { getClassifiableEntities, getEntityTransactions } from "@/lib/queries/review";
import { activeMonthPeriod, periodQueryString } from "@/lib/period";

type Props = {
  searchParams: Promise<{ month?: string; period?: string; at?: string; entity?: string }>;
};

export default async function CategoryBreakdownReportPage({ searchParams }: Props) {
  const params = await searchParams;
  const period = parseReportPeriod(params, activeMonthPeriod());
  const entitySlug = parseReportEntitySlug(params) ?? "personal";
  const periodQuery = periodQueryString(period);

  const [entities, { groups }] = await Promise.all([
    getClassifiableEntities(),
    getEntityTransactions(period, entitySlug),
  ]);

  if (!entities.some((entity) => entity.slug === entitySlug)) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Category breakdown</h1>
          <p className="text-sm text-muted-foreground">
            {entitySlug} · {period.label}
          </p>
        </div>
        <Suspense fallback={null}>
          <ReportFilters period={period} entities={entities} selectedEntitySlug={entitySlug} />
        </Suspense>
      </div>

      <CategoryBreakdown groups={groups} entitySlug={entitySlug} periodQuery={periodQuery} />
    </div>
  );
}
