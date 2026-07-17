"use client";

import { useState, useTransition } from "react";
import { removeFromExpenseReport } from "@/lib/actions/expense-reports";

/**
 * Drop one charge out of this report. Transaction-lines only: a capture is not "in the ledger", so
 * releasing it is a different verb (delete / mark as cash) and belongs to the capture surface.
 *
 * Removing a charge also un-suppresses any capture that was riding on it, so the money reappears as
 * its own line rather than vanishing. That is buildExpenseReportLines' doing, not this button's.
 */
export function RemoveLineButton({ transactionId, label }: { transactionId: string; label: string }) {
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  function remove() {
    setError(null);
    startTransition(async () => {
      const result = await removeFromExpenseReport([transactionId]);
      if ("error" in result) {
        setError(result.error);
        setConfirming(false);
      }
      // On success the row is gone: the action revalidates and this component unmounts with it.
    });
  }

  if (error) {
    return <span className="text-xs text-destructive print:hidden">{error}</span>;
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        title={`Take "${label}" out of this report. The charge stays in your ledger.`}
        aria-label={`Remove ${label} from this report`}
        className="rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground print:hidden"
      >
        Remove
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 print:hidden">
      <button
        type="button"
        onClick={remove}
        disabled={pending}
        className="rounded-md px-1.5 py-0.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
      >
        {pending ? "Removing…" : "Confirm"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={pending}
        className="rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
      >
        Cancel
      </button>
    </span>
  );
}
