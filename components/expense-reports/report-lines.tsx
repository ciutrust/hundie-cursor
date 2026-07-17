import Link from "next/link";
import { ExpensedToggle } from "@/components/expense-reports/expensed-toggle";
import { ReceiptEvidence } from "@/components/expense-reports/receipt-evidence";
import { RemoveLineButton } from "@/components/expense-reports/remove-line-button";
import { pendingCardCaptures, type ExpenseReportLine } from "@/lib/expense-report-lines";
import { cn, formatCurrency } from "@/lib/utils";

/**
 * The trip sheet itself. A server component: only the toggles and the remove control are interactive,
 * so the table stays out of the JS bundle and prints as plain markup.
 */
export function ReportLines({
  lines,
  reportNumber,
  photoUrls,
}: {
  lines: ExpenseReportLine[];
  /** For the "Find the charge" deep link back into this page's reconcile flow. */
  reportNumber: number;
  photoUrls: Record<string, string>;
}) {
  // Reuse the tested predicate rather than string-matching the sublabel: this is the double-count
  // risk (its charge lands later and stacks next to it), so its definition lives in exactly one place.
  const pendingIds = new Set(pendingCardCaptures(lines).map((line) => line.id));

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card print:border-0">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
            <th className="px-3 py-2 font-medium">Date</th>
            <th className="px-3 py-2 font-medium">Description</th>
            <th className="px-3 py-2 text-right font-medium">Amount</th>
            <th className="px-3 py-2 text-right font-medium">Expensed</th>
            <th className="px-3 py-2 print:hidden">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {lines.map((line) => {
            const awaitingCharge = pendingIds.has(line.id);
            // A capture whose amount was never filled in contributes $0 to the trip total. Flag it, or
            // he files the trip short and never sees why.
            const missingAmount = line.kind === "capture" && line.amount === 0;

            return (
              <tr
                key={`${line.kind}:${line.id}`}
                className={cn(
                  "align-top",
                  awaitingCharge
                    ? "bg-amber-50/70 dark:bg-amber-950/20"
                    : "hover:bg-muted/20 print:hover:bg-transparent",
                )}
              >
                <td className="px-3 py-3 whitespace-nowrap tabular-nums text-muted-foreground">
                  {line.date}
                </td>

                <td className="px-3 py-3">
                  <div className="space-y-1.5">
                    <p className="font-medium">{line.label}</p>
                    <p
                      className={cn(
                        "text-xs",
                        awaitingCharge
                          ? "font-medium text-amber-700 dark:text-amber-400"
                          : "text-muted-foreground",
                      )}
                    >
                      {line.sublabel}
                    </p>

                    {line.note ? <p className="text-xs text-muted-foreground">{line.note}</p> : null}

                    {/* Same evidence block either way: a standalone receipt, or the receipt that got
                        reconciled into an otherwise opaque "SQ *XXXX 4471" charge. */}
                    {line.capture ? (
                      <ReceiptEvidence
                        photoPath={line.capture.photoPath}
                        photoStatus={line.capture.photoStatus}
                        // The capture's note is already rendered above as line.note.
                        note={null}
                        latitude={line.capture.latitude}
                        longitude={line.capture.longitude}
                        photoUrls={photoUrls}
                        className="pt-0.5"
                      />
                    ) : null}
                    {line.enrichedBy ? (
                      <ReceiptEvidence
                        photoPath={line.enrichedBy.photoPath}
                        photoStatus={line.enrichedBy.photoStatus}
                        note={line.enrichedBy.note}
                        latitude={line.enrichedBy.latitude}
                        longitude={line.enrichedBy.longitude}
                        photoUrls={photoUrls}
                        className="pt-0.5"
                      />
                    ) : null}

                    {awaitingCharge ? (
                      <Link
                        href={`/expense-reports/${reportNumber}?reconcile=${line.id}`}
                        className="inline-flex text-xs font-medium text-primary hover:underline print:hidden"
                      >
                        Find the charge →
                      </Link>
                    ) : null}
                  </div>
                </td>

                <td className="px-3 py-3 text-right whitespace-nowrap">
                  <span
                    className={cn(
                      "font-medium tabular-nums",
                      line.amount < 0 ? "text-emerald-700 dark:text-emerald-400" : "text-foreground",
                    )}
                  >
                    {formatCurrency(line.amount)}
                  </span>
                  {missingAmount ? (
                    <p className="text-xs text-amber-700 dark:text-amber-400">No amount yet</p>
                  ) : null}
                </td>

                <td className="px-3 py-3 text-right">
                  <ExpensedToggle kind={line.kind} id={line.id} expensedAt={line.expensedAt} />
                </td>

                <td className="px-3 py-3 text-right print:hidden">
                  {line.kind === "transaction" ? (
                    <RemoveLineButton transactionId={line.id} label={line.label} />
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
