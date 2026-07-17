"use client";

import Link from "next/link";
import { useState, useTransition, type FormEvent } from "react";
import { CaptureMatchPrompts } from "@/components/reconcile/capture-match-prompts";
import { getCaptureMatchPrompts, type CaptureMatchPrompt } from "@/components/reconcile/actions";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addToExpenseReport, createExpenseReport } from "@/lib/actions/expense-reports";
import { formatExpenseReportNumber } from "@/lib/date-range";
import type { TransactionWithDetails } from "@/lib/types/database";
import { formatCurrency } from "@/lib/utils";

/** Plain data — a Server Component can pass this across the boundary, unlike a fetcher. */
export type OpenExpenseReport = { id: string; number: number; name: string };

type SavedReport = { id: string; number: number; name: string };

type Mode = "new" | "existing";

type SaveExpenseReportDialogProps = {
  open: boolean;
  transactions: TransactionWithDetails[];
  onOpenChange: (open: boolean) => void;
  /** Called on CLOSE after a successful save, not on save — see handleOpenChange. */
  onSaved: () => void;
  /**
   * Unpaid reports he can add to. Omitted or empty => the mode switch is hidden and this is
   * New-report-only, which is exactly what it was before "add to existing" existed.
   */
  openReports?: OpenExpenseReport[];
};

export function SaveExpenseReportDialog({
  open,
  transactions,
  onOpenChange,
  onSaved,
  openReports,
}: SaveExpenseReportDialogProps) {
  const [mode, setMode] = useState<Mode>("new");
  const [name, setName] = useState("");
  const [targetReportId, setTargetReportId] = useState("");
  // AC's default: a trip's charges are the reimbursed-W2 wash, so pre-check rather than make him remember.
  const [assignJobW2, setAssignJobW2] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedReport | null>(null);
  const [prompts, setPrompts] = useState<CaptureMatchPrompt[]>([]);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const total = transactions.reduce((sum, tx) => sum + Number(tx.amount), 0);
  const canAddToExisting = (openReports?.length ?? 0) > 0;
  const effectiveMode: Mode = canAddToExisting ? mode : "new";

  function resetForm() {
    setSaved(null);
    setName("");
    setTargetReportId("");
    setMode("new");
    setPrompts([]);
    setPromptError(null);
  }

  function handleOpenChange(next: boolean) {
    // An outside click mid-write would orphan the report the server is already creating.
    if (pending) return;

    if (!next && saved) {
      // Clearing the selection is deferred to close: it unmounts the selection bar (and this dialog with
      // it), which would eat the confirmation before AC could read the report number.
      onSaved();
      resetForm();
    }
    setError(null);
    onOpenChange(next);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const transactionIds = transactions.map((tx) => tx.id);
    setError(null);

    if (effectiveMode === "new") {
      const trimmed = name.trim();
      if (!trimmed) return;

      startTransition(async () => {
        const result = await createExpenseReport({
          name: trimmed,
          transactionIds,
          assignJobW2,
        });
        if ("error" in result) {
          setError(result.error);
          return;
        }
        // A brand-new report can't already be holding a receipt, so there is nothing to reconcile.
        setSaved({ id: result.id, number: result.number, name: trimmed });
      });
      return;
    }

    const target = openReports?.find((report) => report.id === targetReportId);
    if (!target) return;

    startTransition(async () => {
      const result = await addToExpenseReport({ reportId: target.id, transactionIds });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setSaved({ id: target.id, number: target.number, name: target.name });

      // Adding a charge to a report that already holds its receipt is THE double-count path: both lines
      // stand until they're matched. Ask now, while he still remembers the spend.
      try {
        setPrompts(await getCaptureMatchPrompts({ reportId: target.id, transactionIds }));
      } catch {
        // The add itself succeeded — don't fail it over an advisory read. But say so plainly: silence
        // here would read as "nothing to reconcile", which is the one wrong thing to imply.
        setPromptError(
          "Couldn't check this report for receipts waiting on a charge. Open the report and look for the same spend listed twice before you file.",
        );
      }
    });
  }

  const selectionSummary = `${transactions.length} transaction${transactions.length === 1 ? "" : "s"} · ${formatCurrency(total)}`;
  const addedToExisting = saved !== null && effectiveMode === "existing";
  const submitDisabled =
    pending || (effectiveMode === "new" ? name.trim().length === 0 : targetReportId === "");

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {saved
              ? addedToExisting
                ? "Added to expense report"
                : "Expense report saved"
              : "Save as expense report"}
          </DialogTitle>
          <DialogDescription>
            {saved ? "The lines are tagged to this report." : selectionSummary}
          </DialogDescription>
        </DialogHeader>

        {saved ? (
          <div className="space-y-4">
            <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm font-medium text-emerald-700 dark:text-emerald-400">
              ✓ {addedToExisting ? `${selectionSummary} added to ` : ""}Expense Report{" "}
              {formatExpenseReportNumber(saved.number)} · {saved.name}
            </p>

            {prompts.length > 0 ? <CaptureMatchPrompts prompts={prompts} /> : null}

            {promptError ? (
              <p
                role="alert"
                className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-400"
              >
                {promptError}
              </p>
            ) : null}

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
            {canAddToExisting ? (
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="expense-report-mode"
                    value="new"
                    checked={effectiveMode === "new"}
                    onChange={() => setMode("new")}
                    className="h-4 w-4 border-border accent-primary"
                  />
                  New report
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="expense-report-mode"
                    value="existing"
                    checked={effectiveMode === "existing"}
                    onChange={() => setMode("existing")}
                    className="h-4 w-4 border-border accent-primary"
                  />
                  Add to existing
                </label>
              </div>
            ) : null}

            {effectiveMode === "new" ? (
              <>
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
              </>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="expense-report-target">Report</Label>
                <Select value={targetReportId} onValueChange={setTargetReportId}>
                  <SelectTrigger id="expense-report-target">
                    <SelectValue placeholder="Pick an open report" />
                  </SelectTrigger>
                  <SelectContent>
                    {openReports?.map((report) => (
                      <SelectItem key={report.id} value={report.id}>
                        {formatExpenseReportNumber(report.number)} · {report.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Unpaid reports only. A paid one has already been filed and reimbursed.
                </p>
              </div>
            )}

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
                <Button type="submit" disabled={submitDisabled}>
                  {pending
                    ? effectiveMode === "new"
                      ? "Saving…"
                      : "Adding…"
                    : effectiveMode === "new"
                      ? "Save report"
                      : "Add to report"}
                </Button>
              </div>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
