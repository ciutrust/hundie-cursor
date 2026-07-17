import Link from "next/link";
import { notFound } from "next/navigation";
import {
  DeleteExpenseReportButton,
  ExpenseReportLines,
} from "@/components/transactions/expense-report-actions";
import { TransactionsExport } from "@/components/transactions/transactions-export";
import { formatExpenseReportNumber } from "@/lib/date-range";
import { getExpenseReportByNumber } from "@/lib/queries/expense-reports";
import {
  getCategoriesByEntity,
  getCategoriesForEntity,
  getClassifiableEntities,
} from "@/lib/queries/review";
import { cn, formatCurrency } from "@/lib/utils";

type ExpenseReportPageProps = {
  params: Promise<{ number: string }>;
};

export default async function ExpenseReportPage({ params }: ExpenseReportPageProps) {
  const { number } = await params;

  // The URL may be padded ("0001") or bare ("1") — both address the same report. Digits-only so a
  // hand-edited "1-foo" 404s instead of silently resolving to report 1 the way parseInt alone would.
  const reportNumber = /^\d+$/.test(number) ? Number.parseInt(number, 10) : Number.NaN;
  if (!Number.isInteger(reportNumber)) notFound();

  const [result, entities, categories, categoriesByEntity] = await Promise.all([
    getExpenseReportByNumber(reportNumber),
    getClassifiableEntities(),
    // The list needs a per-entity category set for its inline picker; personal is the fallback chart
    // for rows whose entity has none of its own.
    getCategoriesForEntity("personal"),
    getCategoriesByEntity(),
  ]);

  if (!result) notFound();
  const { report, transactions } = result;

  const label = formatExpenseReportNumber(report.number);
  // Signed: charges are positive outflows, so a refund inside the trip nets the report down.
  const total = transactions.reduce((sum, tx) => sum + Number(tx.amount), 0);
  const createdOn = report.created_at.slice(0, 10);

  return (
    <div className="space-y-8">
      {/* A div, not <header> — the print stylesheet hides header/nav/aside as app chrome. */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">
            <Link href="/expense-reports" className="hover:text-foreground">
              Expense reports
            </Link>
            {` · ${label}`}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            {`Expense Report ${label} · ${report.name}`}
          </h1>
          <p className="text-sm text-muted-foreground">
            {createdOn} ·{" "}
            <span className="tabular-nums">
              {transactions.length} line{transactions.length === 1 ? "" : "s"}
            </span>{" "}
            ·{" "}
            <span
              className={cn(
                "font-semibold tabular-nums",
                total < 0 ? "text-emerald-700 dark:text-emerald-400" : "text-foreground",
              )}
            >
              {formatCurrency(total)}
            </span>
          </p>
          {report.notes ? (
            <p className="max-w-prose pt-1 text-sm text-muted-foreground">{report.notes}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TransactionsExport
            transactions={transactions}
            filename={`expense-report-${label}.csv`}
          />
          <DeleteExpenseReportButton id={report.id} label={`Expense Report ${label}`} />
        </div>
      </div>

      {transactions.length === 0 ? (
        // TransactionList's zero-row state is review-flavored ("Everything is classified across all
        // entities. Nice work."), which is nonsense on an empty report.
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="font-medium">No lines in this report</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Every charge has been removed from it. Add more from{" "}
            <Link href="/transactions" className="text-primary hover:underline">
              Transactions
            </Link>
            , or delete the report.
          </p>
        </div>
      ) : (
        /* Same list as /transactions so a category or note can still be fixed from inside the report,
           plus a "Remove from report" bulk action. entitySlug="transactions" hides the review-only UI. */
        <ExpenseReportLines
          transactions={transactions}
          entities={entities}
          categories={categories}
          categoriesByEntity={categoriesByEntity}
          month={createdOn}
        />
      )}
    </div>
  );
}
