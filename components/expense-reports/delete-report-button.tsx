"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { deleteExpenseReport } from "@/lib/actions/expense-reports";

/** Deleting a report releases its charges (FK is ON DELETE SET NULL); no transaction is ever deleted. */
export function DeleteReportButton({ id, label }: { id: string; label: string }) {
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
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setConfirming(false)}
        disabled={pending}
      >
        Cancel
      </Button>
      <Button type="button" size="sm" onClick={confirmDelete} disabled={pending}>
        {pending ? "Deleting…" : "Delete"}
      </Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
