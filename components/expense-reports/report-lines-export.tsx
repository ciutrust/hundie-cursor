"use client";

import { Button } from "@/components/ui/button";
import { rowsToCsv } from "@/lib/csv";
import type { ExpenseReportLine } from "@/lib/expense-report-lines";

/**
 * CSV + Print for a report's LINES.
 *
 * Not TransactionsExport: that one takes TransactionWithDetails and exports entity/category columns —
 * a report is a filing artifact, not a tax surface, and half a report's lines are captures that have
 * no transaction row at all. These are the columns AC retypes into Cursor's expense tool.
 */
const HEADER = ["Date", "Description", "Detail", "Amount", "Note", "Expensed"];

function toRows(lines: ExpenseReportLine[]) {
  return lines.map((line) => [
    line.date,
    line.label,
    line.sublabel,
    line.amount.toFixed(2),
    // A charge can carry both its own note and the note from the receipt reconciled into it.
    [line.note, line.enrichedBy?.note].filter(Boolean).join(" / "),
    line.expensedAt ? "Yes" : "No",
  ]);
}

export function ReportLinesExport({
  lines,
  filename,
}: {
  lines: ExpenseReportLine[];
  filename: string;
}) {
  function downloadCsv() {
    // rowsToCsv already neutralizes spreadsheet formula injection.
    const csv = rowsToCsv(HEADER, toRows(lines));
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  const disabled = lines.length === 0;

  return (
    <div className="flex gap-2 print:hidden">
      <Button type="button" variant="outline" size="sm" onClick={downloadCsv} disabled={disabled}>
        Export CSV
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => window.print()}
        disabled={disabled}
      >
        Print
      </Button>
    </div>
  );
}
