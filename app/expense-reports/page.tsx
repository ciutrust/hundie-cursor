import Link from "next/link";
import { ReportStatusBadge } from "@/components/expense-reports/report-status-badge";
import { formatExpenseReportNumber } from "@/lib/date-range";
import {
  getExpenseReports,
  outstandingTotal,
  type ExpenseReportSummary,
} from "@/lib/queries/expense-reports";
import { cn, formatCurrency } from "@/lib/utils";

/**
 * Unpaid first, then newest number. The list is a worklist, not an archive: the reports AC is still
 * owed money on are the only ones he can act on, so they never sit below a wall of settled ones.
 * getExpenseReports already returns number-desc, and Array.sort is stable, but the tiebreak is
 * explicit here so the order does not silently depend on the fetcher's ORDER BY.
 */
function unpaidFirst(reports: ExpenseReportSummary[]): ExpenseReportSummary[] {
  return [...reports].sort(
    (a, b) => Number(Boolean(a.paid_at)) - Number(Boolean(b.paid_at)) || b.number - a.number,
  );
}

export default async function ExpenseReportsPage() {
  const reports = await getExpenseReports();
  const outstanding = outstandingTotal(reports);
  const sorted = unpaidFirst(reports);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Expense reports</h1>
        <p className="text-sm text-muted-foreground">
          Each report bundles the charges from one trip so you can file them together.
        </p>
      </div>

      {reports.length > 0 ? (
        <div
          className={cn(
            "rounded-xl border p-5",
            outstanding.count > 0
              ? "border-amber-200 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/20"
              : "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/60 dark:bg-emerald-950/20",
          )}
        >
          {outstanding.count > 0 ? (
            <>
              <p className="text-3xl font-semibold tabular-nums text-amber-900 dark:text-amber-200">
                {formatCurrency(outstanding.total)} outstanding
              </p>
              <p className="mt-1 text-sm text-amber-800/80 dark:text-amber-300/80">
                Across {outstanding.count} unpaid report{outstanding.count === 1 ? "" : "s"}. This is
                money you have not been paid back yet.
              </p>
            </>
          ) : (
            <>
              <p className="text-xl font-semibold text-emerald-900 dark:text-emerald-200">
                All square. Nothing outstanding.
              </p>
              <p className="mt-1 text-sm text-emerald-800/80 dark:text-emerald-300/80">
                Every report has been reimbursed. Nice work.
              </p>
            </>
          )}
        </div>
      ) : null}

      {reports.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="text-base font-medium">No reports yet</h2>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            Pick your cards and a date range on the Transactions page, select the charges that belong to
            the trip, then click Save as Expense Report. It lands here.
          </p>
          <Link
            href="/transactions"
            className="mt-4 inline-flex text-sm font-medium text-primary hover:underline"
          >
            Go to Transactions →
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">Report</th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Lines</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                <th className="px-3 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sorted.map((report) => (
                <tr key={report.id} className="hover:bg-muted/20">
                  <td className="px-3 py-2 font-semibold whitespace-nowrap tabular-nums">
                    <Link href={`/expense-reports/${report.number}`} className="hover:underline">
                      {formatExpenseReportNumber(report.number)}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/expense-reports/${report.number}`} className="hover:underline">
                      {report.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <ReportStatusBadge paidAt={report.paid_at} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{report.count}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(report.total)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                    {report.created_at.slice(0, 10)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
