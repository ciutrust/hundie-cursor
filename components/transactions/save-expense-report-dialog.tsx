"use client";

import Link from "next/link";
import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createExpenseReport } from "@/lib/actions/expense-reports";
import { formatExpenseReportNumber } from "@/lib/date-range";
import type { TransactionWithDetails } from "@/lib/types/database";
import { formatCurrency } from "@/lib/utils";

type SavedReport = { id: string; number: number; name: string };

type SaveExpenseReportDialogProps = {
  open: boolean;
  transactions: TransactionWithDetails[];
  onOpenChange: (open: boolean) => void;
  /** Called on CLOSE after a successful save, not on save — see handleOpenChange. */
  onSaved: () => void;
};

export function SaveExpenseReportDialog({
  open,
  transactions,
  onOpenChange,
  onSaved,
}: SaveExpenseReportDialogProps) {
  const [name, setName] = useState("");
  // AC's default: a trip's charges are the reimbursed-W2 wash, so pre-check rather than make him remember.
  const [assignJobW2, setAssignJobW2] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedReport | null>(null);
  const [pending, startTransition] = useTransition();

  const total = transactions.reduce((sum, tx) => sum + Number(tx.amount), 0);

  function handleOpenChange(next: boolean) {
    // An outside click mid-write would orphan the report the server is already creating.
    if (pending) return;

    if (!next && saved) {
      // Clearing the selection is deferred to close: it unmounts the selection bar (and this dialog with
      // it), which would eat the confirmation before AC could read the report number.
      onSaved();
      setSaved(null);
      setName("");
    }
    setError(null);
    onOpenChange(next);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    setError(null);
    startTransition(async () => {
      const result = await createExpenseReport({
        name: trimmed,
        transactionIds: transactions.map((tx) => tx.id),
        assignJobW2,
      });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setSaved({ id: result.id, number: result.number, name: trimmed });
    });
  }

  const selectionSummary = `${transactions.length} transaction${transactions.length === 1 ? "" : "s"} · ${formatCurrency(total)}`;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{saved ? "Expense report saved" : "Save as expense report"}</DialogTitle>
          <DialogDescription>
            {saved ? "The lines are tagged to this report." : selectionSummary}
          </DialogDescription>
        </DialogHeader>

        {saved ? (
          <div className="space-y-4">
            <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm font-medium text-emerald-700 dark:text-emerald-400">
              ✓ Expense Report {formatExpenseReportNumber(saved.number)} · {saved.name}
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                Done
              </Button>
              <Button asChild>
                <Link href={`/expense-reports/${saved.number}`}>View report</Link>
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="expense-report-name">Name</Label>
              <Input
                id="expense-report-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Workidate Sacramento"
                autoFocus
                required
              />
            </div>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={assignJobW2}
                onChange={(event) => setAssignJobW2(event.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-primary"
              />
              <span>
                Also categorize all as Job W2 Expenses
                <span className="block text-xs text-muted-foreground">
                  Books them as the reimbursed travel wash: not a deduction, not personal spend.
                </span>
              </span>
            </label>

            {error ? (
              <p role="alert" className="text-sm font-medium text-red-600 dark:text-red-400">
                {error}
              </p>
            ) : null}

            <div className="flex items-center justify-between gap-3">
              <p className="text-sm tabular-nums text-muted-foreground">{selectionSummary}</p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleOpenChange(false)}
                  disabled={pending}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={pending || name.trim().length === 0}>
                  {pending ? "Saving…" : "Save report"}
                </Button>
              </div>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
