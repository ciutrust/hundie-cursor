"use client";

import { useState, useTransition } from "react";
import {
  SaveExpenseReportDialog,
  type OpenExpenseReport,
} from "@/components/transactions/save-expense-report-dialog";
import { TransactionList } from "@/components/review/transaction-list";
import { Button } from "@/components/ui/button";
import { assignJobW2Expenses } from "@/lib/actions/expense-reports";
import type { Category, Entity, TransactionWithDetails } from "@/lib/types/database";

type EntityCategory = Pick<Category, "id" | "full_path">;

type TransactionSelectionActionsProps = {
  selected: TransactionWithDetails[];
  clearSelection: () => void;
  openReports?: OpenExpenseReport[];
};

/** The two /transactions-only bulk actions, injected into TransactionList's selection bar. */
function TransactionSelectionActions({
  selected,
  clearSelection,
  openReports,
}: TransactionSelectionActionsProps) {
  const [error, setError] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function assign() {
    setError(null);
    startTransition(async () => {
      const result = await assignJobW2Expenses(selected.map((tx) => tx.id));
      if ("error" in result) {
        // Keep the selection on failure: clearing it would hide both the rows and this message.
        setError(result.error);
        return;
      }
      clearSelection();
    });
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={assign}
        disabled={pending}
        title="Books them to Personal / Job W2 Expenses: the reimbursed-W2 travel wash, not a deduction and not personal spend."
      >
        {pending ? "Assigning…" : "Assign to Job W2 Expenses"}
      </Button>
      <Button variant="outline" size="sm" onClick={() => setSaveOpen(true)}>
        Save as Expense Report
      </Button>

      {/* basis-full: breaks onto its own line inside the selection bar's flex-wrap row. */}
      {error ? (
        <p role="alert" className="basis-full text-sm font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}

      <SaveExpenseReportDialog
        open={saveOpen}
        transactions={selected}
        onOpenChange={setSaveOpen}
        onSaved={clearSelection}
        openReports={openReports}
      />
    </>
  );
}

type TransactionsBrowserListProps = {
  transactions: TransactionWithDetails[];
  entities: Pick<Entity, "id" | "name" | "slug">[];
  categories: EntityCategory[];
  categoriesByEntity: Record<string, EntityCategory[]>;
  month: string;
  /**
   * Unpaid reports, for the save dialog's "add to existing" mode. Fetched by the page — plain data
   * crosses the boundary fine. Omit it and the dialog degrades to New-report-only.
   */
  openReports?: OpenExpenseReport[];
};

/**
 * Thin client wrapper: renderSelectionActions is a function prop, which a Server Component cannot pass
 * across the boundary, so the render-prop is owned here instead of on the page.
 */
export function TransactionsBrowserList({
  transactions,
  entities,
  categories,
  categoriesByEntity,
  month,
  openReports,
}: TransactionsBrowserListProps) {
  return (
    <TransactionList
      transactions={transactions}
      entities={entities}
      categories={categories}
      categoriesByEntity={categoriesByEntity}
      month={month}
      // Sentinel: not a real entity slug, so the review-only suggestion pills / Generate / backlog toggle stay hidden.
      entitySlug="transactions"
      renderSelectionActions={(selected, { clearSelection }) => (
        <TransactionSelectionActions
          selected={selected}
          clearSelection={clearSelection}
          openReports={openReports}
        />
      )}
    />
  );
}
