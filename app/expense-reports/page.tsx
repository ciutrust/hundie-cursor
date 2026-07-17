import Link from "next/link";
import { formatExpenseReportNumber } from "@/lib/date-range";
import { getExpenseReports } from "@/lib/queries/expense-reports";
import { formatCurrency } from "@/lib/utils";

export default async function ExpenseReportsPage() {
  const reports = await getExpenseReports();

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Expense reports</h1>
        <p className="text-sm text-muted-foreground">
          Each report bundles the charges from one trip so you can file them together.
        </p>
      </div>

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
                <th className="px-3 py-2 font-medium text-right">Lines</th>
                <th className="px-3 py-2 font-medium text-right">Total</th>
                <th className="px-3 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {reports.map((report) => (
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
                  <td className="px-3 py-2 text-right tabular-nums">{report.transactionCount}</td>
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
