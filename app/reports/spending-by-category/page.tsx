import { Suspense } from "react";
import { notFound } from "next/navigation";
import { MonthlyCategoryMatrix } from "@/components/review/monthly-category-matrix";
import { ReportFilters, parseReportEntitySlug, parseReportPeriod } from "@/components/reports/report-filters";
import { getClassifiableEntities, getMonthlyCategoryMatrix } from "@/lib/queries/review";
import { activeMonthPeriod } from "@/lib/period";

type Props = {
  searchParams: Promise<{ month?: string; period?: string; at?: string; entity?: string }>;
};

export default async function SpendingByCategoryReportPage({ searchParams }: Props) {
  const params = await searchParams;
  const period = parseReportPeriod(params, activeMonthPeriod());
  const entitySlug = parseReportEntitySlug(params) ?? "personal";
  const matrixYear = Number(period.start.slice(0, 4));
  const now = new Date();

  const [entities, rows] = await Promise.all([
    getClassifiableEntities(),
    getMonthlyCategoryMatrix(entitySlug, matrixYear),
  ]);

  if (!entities.some((entity) => entity.slug === entitySlug)) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Spending by category</h1>
          <p className="text-sm text-muted-foreground">
            {entitySlug} · {matrixYear} monthly matrix
          </p>
        </div>
        <Suspense fallback={null}>
          <ReportFilters period={period} entities={entities} selectedEntitySlug={entitySlug} />
        </Suspense>
      </div>

      <MonthlyCategoryMatrix
        rows={rows}
        entitySlug={entitySlug}
        year={matrixYear}
        currentYear={now.getFullYear()}
        currentMonth={now.getMonth() + 1}
      />
    </div>
  );
}
