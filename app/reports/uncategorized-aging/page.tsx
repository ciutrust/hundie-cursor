import { Suspense } from "react";
import { ReportFilters } from "@/components/reports/report-filters";
import { parseReportEntitySlug, parseReportPeriod } from "@/lib/reports/report-params";
import { getUncategorizedAging } from "@/lib/queries/report-analytics";
import { getClassifiableEntities } from "@/lib/queries/review";
import { activeMonthPeriod } from "@/lib/period";
import { formatCurrency } from "@/lib/utils";

type Props = {
  searchParams: Promise<{ month?: string; period?: string; at?: string; entity?: string }>;
};

export default async function UncategorizedAgingReportPage({ searchParams }: Props) {
  const params = await searchParams;
  const period = parseReportPeriod(params, activeMonthPeriod());
  const entitySlug = parseReportEntitySlug(params);
  const [entities, rows] = await Promise.all([
    getClassifiableEntities(),
    getUncategorizedAging(period, entitySlug),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Uncategorized aging</h1>
          <p className="text-sm text-muted-foreground">Oldest uncategorized first · {period.label}</p>
        </div>
        <Suspense fallback={null}>
          <ReportFilters period={period} entities={entities} selectedEntitySlug={entitySlug} />
        </Suspense>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
              <th className="px-3 py-2 font-medium">Days</th>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Entity</th>
              <th className="px-3 py-2 font-medium">Description</th>
              <th className="px-3 py-2 font-medium text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.slice(0, 200).map((row) => (
              <tr key={row.id}>
                <td className="px-3 py-2 tabular-nums">{row.daysOld}</td>
                <td className="px-3 py-2">{row.transaction_date}</td>
                <td className="px-3 py-2">{row.entityName}</td>
                <td className="max-w-xs truncate px-3 py-2">{row.description}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(row.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
