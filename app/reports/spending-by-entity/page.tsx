import { Suspense } from "react";
import { MonthlyEntityMatrix } from "@/components/review/monthly-entity-matrix";
import { ReportFilters } from "@/components/reports/report-filters";
import { parseReportEntitySlug, parseReportPeriod } from "@/lib/reports/report-params";
import { getClassifiableEntities, getMonthlyEntityMatrix } from "@/lib/queries/review";
import { activeMonthPeriod } from "@/lib/period";

type Props = {
  searchParams: Promise<{ month?: string; period?: string; at?: string; entity?: string }>;
};

export default async function SpendingByEntityReportPage({ searchParams }: Props) {
  const params = await searchParams;
  const period = parseReportPeriod(params, activeMonthPeriod());
  const entitySlug = parseReportEntitySlug(params);
  const matrixYear = Number(period.start.slice(0, 4));
  const now = new Date();

  const [entities, rows] = await Promise.all([
    getClassifiableEntities(),
    getMonthlyEntityMatrix(matrixYear),
  ]);

  const filterSlugs = entitySlug
    ? [entitySlug]
    : entities.map((entity) => entity.slug);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Spending by entity</h1>
          <p className="text-sm text-muted-foreground">{matrixYear} monthly matrix</p>
        </div>
        <Suspense fallback={null}>
          <ReportFilters period={period} entities={entities} selectedEntitySlug={entitySlug} />
        </Suspense>
      </div>

      <MonthlyEntityMatrix
        rows={rows}
        year={matrixYear}
        currentYear={now.getFullYear()}
        currentMonth={now.getMonth() + 1}
        filterSlugs={filterSlugs}
        title={`${matrixYear} entity spending`}
        subtitle="Operating expenses by entity and month"
      />
    </div>
  );
}
