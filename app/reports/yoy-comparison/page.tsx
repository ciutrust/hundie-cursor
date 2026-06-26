import { Suspense } from "react";
import { ReportFilters } from "@/components/reports/report-filters";
import { parseReportPeriod } from "@/lib/reports/report-params";
import { getYoyEntityComparison } from "@/lib/queries/report-analytics";
import { getClassifiableEntities } from "@/lib/queries/review";
import { activeMonthPeriod } from "@/lib/period";
import { formatCurrency } from "@/lib/utils";

type Props = {
  searchParams: Promise<{ month?: string; period?: string; at?: string }>;
};

export default async function YoyComparisonReportPage({ searchParams }: Props) {
  const params = await searchParams;
  const period = parseReportPeriod(params, activeMonthPeriod());
  const [entities, rows] = await Promise.all([
    getClassifiableEntities(),
    getYoyEntityComparison(period),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Year-over-year comparison</h1>
          <p className="text-sm text-muted-foreground">
            {period.label} vs prior period ({period.compareStart} – {period.compareEnd})
          </p>
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
              <th className="px-4 py-3 font-medium text-right">Current</th>
              <th className="px-4 py-3 font-medium text-right">Prior</th>
              <th className="px-4 py-3 font-medium text-right">Change</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.entitySlug}>
                <td className="px-4 py-3 font-medium">{row.entityName}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(row.currentTotal)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(row.priorTotal)}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {row.changePct != null ? `${row.changePct >= 0 ? "+" : ""}${Math.round(row.changePct * 100)}%` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
