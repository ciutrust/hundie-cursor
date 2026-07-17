"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { TransactionList } from "@/components/review/transaction-list";
import { Button } from "@/components/ui/button";
import { deleteExpenseReport, removeFromExpenseReport } from "@/lib/actions/expense-reports";
import type { Category, Entity, TransactionWithDetails } from "@/lib/types/database";

type EntityCategory = Pick<Category, "id" | "full_path">;

/**
 * Thin client wrapper: renderSelectionActions is a function prop, which a Server Component cannot pass
 * to a Client Component. Mirrors TransactionsBrowserList on /transactions, but the report's bulk action
 * is "remove from this report" instead of the browser's save/assign pair.
 */
export function ExpenseReportLines({
  transactions,
  entities,
  categories,
  categoriesByEntity,
  month,
}: {
  transactions: TransactionWithDetails[];
  entities: Pick<Entity, "id" | "name" | "slug">[];
  categories: EntityCategory[];
  categoriesByEntity: Record<string, EntityCategory[]>;
  month: string;
}) {
  return (
    <TransactionList
      transactions={transactions}
      entities={entities}
      categories={categories}
      categoriesByEntity={categoriesByEntity}
      month={month}
      entitySlug="transactions"
      renderSelectionActions={(selected, { clearSelection }) => (
        <RemoveFromReportButton selected={selected} clearSelection={clearSelection} />
      )}
    />
  );
}

function RemoveFromReportButton({
  selected,
  clearSelection,
}: {
  selected: TransactionWithDetails[];
  clearSelection: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function remove() {
    setError(null);
    startTransition(async () => {
      const result = await removeFromExpenseReport(selected.map((tx) => tx.id));
      if ("error" in result) {
        // Keep the selection on failure, or clearing it would hide the rows AND this message.
        setError(result.error);
        return;
      }
      clearSelection();
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={remove}
        disabled={pending}
        title="Take these lines out of this report. The transactions and their categories are untouched."
      >
        {pending ? "Removing…" : "Remove from report"}
      </Button>
      {error ? <span className="self-center text-xs text-destructive">{error}</span> : null}
    </>
  );
}

/** Deleting a report releases its lines (FK is ON DELETE SET NULL); no transaction is ever deleted. */
export function DeleteExpenseReportButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirmDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteExpenseReport(id);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.push("/expense-reports");
    });
  }

  if (!confirming) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setConfirming(true)}
        className="print:hidden"
      >
        Delete report
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <span className="text-xs text-muted-foreground">
        Delete {label}? The charges stay in your ledger.
      </span>
      <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(false)} disabled={pending}>
        Cancel
      </Button>
      <Button type="button" size="sm" onClick={confirmDelete} disabled={pending}>
        {pending ? "Deleting…" : "Delete"}
      </Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
