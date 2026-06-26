import { Suspense } from "react";
import { ReportFilters } from "@/components/reports/report-filters";
import { parseReportEntitySlug, parseReportPeriod } from "@/lib/reports/report-params";
import { getReportTransactions } from "@/lib/queries/reports";
import { getClassifiableEntities } from "@/lib/queries/review";
import { activeMonthPeriod } from "@/lib/period";
import { formatCurrency } from "@/lib/utils";

type Props = {
  searchParams: Promise<{ month?: string; period?: string; at?: string; entity?: string }>;
};

export default async function TransactionsReportPage({ searchParams }: Props) {
  const params = await searchParams;
  const period = parseReportPeriod(params, activeMonthPeriod());
  const entitySlug = parseReportEntitySlug(params);
  const [entities, rows] = await Promise.all([
    getClassifiableEntities(),
    getReportTransactions(period, entitySlug),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Transaction detail</h1>
          <p className="text-sm text-muted-foreground">
            {period.label} · {rows.length.toLocaleString()} rows
            {entitySlug ? ` · ${entitySlug}` : " · all entities"}
          </p>
        </div>
        <Suspense fallback={null}>
          <ReportFilters period={period} entities={entities} selectedEntitySlug={entitySlug} />
        </Suspense>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Entity</th>
              <th className="px-3 py-2 font-medium">Account</th>
              <th className="px-3 py-2 font-medium">Description</th>
              <th className="px-3 py-2 font-medium">Category</th>
              <th className="px-3 py-2 font-medium text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.slice(0, 500).map((row, index) => (
              <tr key={`${row.transaction_date}-${index}`} className="hover:bg-muted/20">
                <td className="px-3 py-2 whitespace-nowrap">{row.transaction_date}</td>
                <td className="px-3 py-2">{row.entity_name}</td>
                <td className="px-3 py-2">{row.account_name}</td>
                <td className="max-w-xs truncate px-3 py-2">{row.description}</td>
                <td className="px-3 py-2">{row.category_name}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(row.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 500 ? (
          <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
            Showing first 500 of {rows.length.toLocaleString()} — use CSV export for full data.
          </p>
        ) : null}
      </div>
    </div>
  );
}
