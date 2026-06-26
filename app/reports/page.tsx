import Link from "next/link";
import { Suspense } from "react";
import { PeriodPicker } from "@/components/review/period-picker";
import { ReportExportButton } from "@/components/reports/report-export-button";
import { parsePeriodParams, periodQueryString } from "@/lib/period";
import { getReportByEntity, getReportTransactions } from "@/lib/queries/reports";
import { formatCurrency } from "@/lib/utils";

type ReportsPageProps = {
  searchParams: Promise<{ month?: string; period?: string; at?: string }>;
};

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const params = await searchParams;
  const period = parsePeriodParams(params);
  const periodQuery = periodQueryString(period);
  const backlogHref = `/review/unclassified?${periodQueryString(period)}`;
  const [rows, transactions] = await Promise.all([getReportByEntity(period), getReportTransactions(period)]);
  const grandTotal = rows.reduce((sum, row) => sum + row.total, 0);
  const unclassifiedTotal = rows.reduce((sum, row) => sum + row.unclassifiedTotal, 0);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-primary">Reports</p>
          <h1 className="text-3xl font-semibold tracking-tight">{period.label}</h1>
          <p className="text-sm text-muted-foreground">
            {formatCurrency(grandTotal)} total ·{" "}
            {unclassifiedTotal > 0 ? (
              <Link href={backlogHref} className="font-medium text-destructive hover:underline">
                {formatCurrency(unclassifiedTotal)} still uncategorized
              </Link>
            ) : (
              <span>{formatCurrency(unclassifiedTotal)} still uncategorized</span>
            )}
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:items-end">
          <Suspense fallback={null}>
            <PeriodPicker period={period} />
          </Suspense>
          <ReportExportButton
            period={{ type: period.type, at: period.at }}
            rowCount={transactions.length}
            periodLabel={period.label}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-4 text-sm">
        <Link href="/reports/reconcile" className="font-medium text-primary hover:underline">
          GBSL checking reconciliation
        </Link>
        <Link href="/reports/business-expenses-personal-cards" className="font-medium text-primary hover:underline">
          Business expenses on personal cards
        </Link>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
              <th className="px-4 py-3 font-medium">Entity</th>
              <th className="px-4 py-3 font-medium">Expenses</th>
              <th className="px-4 py-3 font-medium">Transactions</th>
              <th className="px-4 py-3 font-medium">Uncategorized</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => {
              const entityHref = `/review/${row.slug}?${periodQuery}`;
              const uncategorizedHref = `/review/${row.slug}?${periodQueryString(period, { category: "unclassified" })}`;

              return (
              <tr key={row.slug} className="hover:bg-muted/20">
                <td className="px-4 py-3 font-medium">
                  <Link href={entityHref} className="hover:text-primary">
                    {row.name}
                  </Link>
                </td>
                <td className="px-4 py-3 tabular-nums">{formatCurrency(row.total)}</td>
                <td className="px-4 py-3 tabular-nums">
                  <Link href={entityHref} className="hover:text-primary hover:underline">
                    {row.transactionCount}
                  </Link>
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {row.unclassifiedCount > 0 ? (
                    <Link
                      href={uncategorizedHref}
                      className="font-medium text-destructive hover:underline"
                      title="Review and categorize these transactions"
                    >
                      {row.unclassifiedCount} · {formatCurrency(row.unclassifiedTotal)}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
