import { Suspense } from "react";
import { ReportFilters } from "@/components/reports/report-filters";
import { parseReportEntitySlug, parseReportPeriod } from "@/lib/reports/report-params";
import { getTopVendors } from "@/lib/queries/report-analytics";
import { getClassifiableEntities } from "@/lib/queries/review";
import { activeMonthPeriod } from "@/lib/period";
import { formatCurrency } from "@/lib/utils";

type Props = {
  searchParams: Promise<{ month?: string; period?: string; at?: string; entity?: string }>;
};

export default async function TopVendorsReportPage({ searchParams }: Props) {
  const params = await searchParams;
  const period = parseReportPeriod(params, activeMonthPeriod());
  const entitySlug = parseReportEntitySlug(params);
  const [entities, rows] = await Promise.all([
    getClassifiableEntities(),
    getTopVendors(period, entitySlug),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Top vendors</h1>
          <p className="text-sm text-muted-foreground">{period.label}</p>
        </div>
        <Suspense fallback={null}>
          <ReportFilters period={period} entities={entities} selectedEntitySlug={entitySlug} />
        </Suspense>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
              <th className="px-4 py-3 font-medium">Vendor</th>
              <th className="px-4 py-3 font-medium">Entity</th>
              <th className="px-4 py-3 font-medium">Count</th>
              <th className="px-4 py-3 font-medium text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={`${row.entitySlug}-${row.vendorKey}`}>
                <td className="px-4 py-3 font-medium">{row.label}</td>
                <td className="px-4 py-3">{row.entitySlug}</td>
                <td className="px-4 py-3 tabular-nums">{row.count}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(row.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
