"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setPairLegCategory } from "@/lib/actions/intercompany";
import { setSplitLegCategory } from "@/lib/actions/split-transaction";
import { formatCurrency } from "@/lib/utils";
import type { ReportTransactionRow } from "@/lib/queries/reports";

export type EntityCategoryOption = { id: string; full_path: string };

export type EditableReportRowsProps = {
  rows: ReportTransactionRow[];
  /** Category options keyed by entity slug - each row's select only offers its OWN entity's chart. */
  categoriesByEntity: Record<string, EntityCategoryOption[]>;
};

/**
 * The transaction-detail table with the Category column editable in place. Deliberately NOT the
 * full TransactionList editor: report rows are LINES (split legs replace parents, and a leg's id
 * collides with its siblings' parent id), so this stays a thin per-row select in the intercompany
 * One-sided style. Whole rows write through setPairLegCategory (validates category-in-entity);
 * split legs write transaction_splits.category_id through setSplitLegCategory - reclassify would
 * edit the parent's hidden classification and visibly change nothing.
 */
export function EditableReportRows({ rows, categoriesByEntity }: EditableReportRowsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errorRow, setErrorRow] = useState<{ key: string; message: string } | null>(null);

  const rowKey = (row: ReportTransactionRow) => row.leg_id ?? row.transaction_id;

  const changeCategory = (row: ReportTransactionRow, categoryId: string | null) =>
    startTransition(async () => {
      const result = row.leg_id
        ? await setSplitLegCategory({ legId: row.leg_id, categoryId })
        : await setPairLegCategory({ transactionId: row.transaction_id, categoryId });
      if ("error" in result) {
        setErrorRow({ key: rowKey(row), message: result.error });
        return;
      }
      setErrorRow(null);
      router.refresh();
    });

  return (
    <tbody className="divide-y divide-border">
      {rows.map((row) => {
        const key = rowKey(row);
        const options = categoriesByEntity[row.entity_slug] ?? [];
        return (
          <tr key={key} className="hover:bg-muted/20">
            <td className="px-3 py-2 whitespace-nowrap">{row.transaction_date}</td>
            <td className="px-3 py-2 whitespace-nowrap">
              {row.entity_name}
              {row.leg_id ? (
                <span
                  className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                  title="This entity's share of a charge split across entities - the amount is the leg, not the whole card charge"
                >
                  split
                </span>
              ) : null}
            </td>
            <td className="px-3 py-2">{row.account_name}</td>
            <td className="max-w-xs truncate px-3 py-2" title={row.notes ?? row.description}>
              {row.description}
            </td>
            <td className="px-3 py-2">
              <select
                value={row.category_id ?? ""}
                disabled={isPending || options.length === 0}
                onChange={(event) =>
                  changeCategory(row, event.target.value === "" ? null : event.target.value)
                }
                aria-label={`Category for ${row.description}`}
                className="w-full max-w-64 rounded-md border border-border bg-card px-2 py-1 text-sm"
              >
                <option value="">Uncategorized</option>
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.full_path}
                  </option>
                ))}
              </select>
              {errorRow?.key === key ? (
                <p role="alert" className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">
                  {errorRow.message}
                </p>
              ) : null}
            </td>
            <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(row.amount)}</td>
          </tr>
        );
      })}
    </tbody>
  );
}
