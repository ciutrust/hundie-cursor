"use client";

import { Button } from "@/components/ui/button";
import { rowsToCsv } from "@/lib/csv";
import type { TransactionWithDetails } from "@/lib/types/database";

const HEADER = [
  "Date",
  "Account",
  "Description",
  "Vendor",
  "Entity",
  "Category",
  "Amount",
  "Notes",
];

function toRows(transactions: TransactionWithDetails[]) {
  return transactions.map((tx) => [
    tx.transaction_date,
    tx.account.display_name,
    tx.description,
    tx.vendor ?? "",
    tx.classification.entity?.name ?? "",
    tx.classification.category?.full_path ?? "Uncategorized",
    Number(tx.amount).toFixed(2),
    tx.classification.notes ?? "",
  ]);
}

/**
 * CSV + Print for a transaction list — shared by the /transactions browser and an expense report's
 * detail, so both export the same columns. `rowsToCsv` already neutralizes formula injection.
 */
export function TransactionsExport({
  transactions,
  filename,
}: {
  transactions: TransactionWithDetails[];
  filename: string;
}) {
  function downloadCsv() {
    const csv = rowsToCsv(HEADER, toRows(transactions));
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  const disabled = transactions.length === 0;

  return (
    <div className="flex gap-2 print:hidden">
      <Button type="button" variant="outline" size="sm" onClick={downloadCsv} disabled={disabled}>
        Export CSV
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={() => window.print()} disabled={disabled}>
        Print
      </Button>
    </div>
  );
}
