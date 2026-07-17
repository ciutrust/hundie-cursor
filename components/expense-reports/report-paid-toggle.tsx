"use client";

import { useState, useTransition } from "react";
import { setExpenseReportPaid } from "@/lib/actions/expense-reports";
import { cn } from "@/lib/utils";

/**
 * PAID / UNPAID for the whole report — did Cursor actually reimburse it.
 *
 * The button shows the CURRENT state (green paid / amber unpaid) and `title` says what a click does,
 * rather than the button reading as a command. This is the one control that moves money out of
 * "outstanding" on the list page, so it should never be ambiguous about which way it is pointing.
 */
export function ReportPaidToggle({ id, paidAt }: { id: string; paidAt: string | null }) {
  const paid = Boolean(paidAt);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle() {
    setError(null);
    startTransition(async () => {
      const result = await setExpenseReportPaid({ id, paid: !paid });
      if ("error" in result) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col items-start gap-1 print:hidden">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={paid}
        title={
          paid
            ? "Marked paid. Click to move it back to unpaid."
            : "Not reimbursed yet. Click once the money lands."
        }
        className={cn(
          "inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors disabled:opacity-50",
          paid
            ? "border-emerald-300 bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300 dark:hover:bg-emerald-950"
            : "border-amber-300 bg-amber-100 text-amber-800 hover:bg-amber-200 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300 dark:hover:bg-amber-950",
        )}
      >
        <span
          className={cn(
            "size-2 rounded-full",
            paid ? "bg-emerald-600 dark:bg-emerald-400" : "bg-amber-600 dark:bg-amber-400",
          )}
          aria-hidden
        />
        {pending ? "Saving…" : paid ? "Paid" : "Unpaid"}
      </button>
      {paidAt ? (
        <span className="text-xs text-muted-foreground">Reimbursed {paidAt.slice(0, 10)}</span>
      ) : null}
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
