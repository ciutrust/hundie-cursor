import { Suspense } from "react";
import { ReportFilters, parseReportPeriod } from "@/components/reports/report-filters";
import { getClassificationProgress } from "@/lib/queries/report-analytics";
import { getClassifiableEntities } from "@/lib/queries/review";
import { activeMonthPeriod } from "@/lib/period";

type Props = {
  searchParams: Promise<{ month?: string; period?: string; at?: string }>;
};

export default async function ClassificationProgressReportPage({ searchParams }: Props) {
  const params = await searchParams;
  const period = parseReportPeriod(params, activeMonthPeriod());
  const [entities, rows] = await Promise.all([
    getClassifiableEntities(),
    getClassificationProgress(period),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Classification progress</h1>
          <p className="text-sm text-muted-foreground">{period.label}</p>
        </div>
        <Suspense fallback={null}>
          <ReportFilters period={period} entities={entities} showEntityFilter={false} />
        </Suspense>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
              <th className="px-4 py-3 font-medium">Entity</th>
              <th className="px-4 py-3 font-medium">Total</th>
              <th className="px-4 py-3 font-medium">Classified</th>
              <th className="px-4 py-3 font-medium">Uncategorized</th>
              <th className="px-4 py-3 font-medium">Progress</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.entitySlug}>
                <td className="px-4 py-3 font-medium">{row.entityName}</td>
                <td className="px-4 py-3 tabular-nums">{row.totalCount}</td>
                <td className="px-4 py-3 tabular-nums">{row.classifiedCount}</td>
                <td className="px-4 py-3 tabular-nums">{row.unclassifiedCount}</td>
                <td className="px-4 py-3 tabular-nums">{Math.round(row.classifiedPct * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
