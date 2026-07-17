"use client";

import { useState, useTransition } from "react";
import { setLineExpensed } from "@/lib/actions/expense-reports";
import { cn } from "@/lib/utils";

/**
 * The per-line filing tick: has this one spend been typed into Cursor's expense tool yet.
 *
 * Red is the default state on purpose — an untouched report should read as a wall of "not filed yet",
 * and turning the last row green is the finish line. Toggling never moves the trip total.
 */
export function ExpensedToggle({
  kind,
  id,
  expensedAt,
}: {
  kind: "transaction" | "capture";
  id: string;
  expensedAt: string | null;
}) {
  const expensed = Boolean(expensedAt);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle() {
    setError(null);
    startTransition(async () => {
      const result = await setLineExpensed({ kind, id, expensed: !expensed });
      if ("error" in result) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={expensed}
        title={
          expensed
            ? "Filed in the expense tool. Click to un-tick it."
            : "Not filed yet. Click once it is in the expense tool."
        }
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors disabled:opacity-50 print:hidden",
          expensed
            ? "border-emerald-300 bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300 dark:hover:bg-emerald-950"
            : "border-rose-300 bg-rose-100 text-rose-800 hover:bg-rose-200 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300 dark:hover:bg-rose-950",
        )}
      >
        <span
          className={cn(
            "size-1.5 rounded-full",
            expensed ? "bg-emerald-600 dark:bg-emerald-400" : "bg-rose-600 dark:bg-rose-400",
          )}
          aria-hidden
        />
        {pending ? "Saving…" : expensed ? "Expensed" : "Not expensed"}
      </button>
      {/* The toggle is a control, so it prints as nothing. On paper the state still has to be legible. */}
      <span className="hidden text-xs print:block">{expensed ? "Expensed" : "Not expensed"}</span>
      {error ? <span className="text-xs text-destructive print:hidden">{error}</span> : null}
    </div>
  );
}
