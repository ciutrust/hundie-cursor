"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { confirmBillPayments } from "@/lib/actions/bills";
import { formatCurrency } from "@/lib/utils";
import { formatBillDate } from "./format";
import type { BillPaymentSuggestion } from "@/lib/queries/bills";

export function PaymentSuggestions({ suggestions }: { suggestions: BillPaymentSuggestion[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  // Unchecked ids rather than checked ones: new suggestions arriving after a sync start selected,
  // which is the point of the bulk action (confirm everything that looks right, uncheck the odd one).
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  // Holds both hard errors and the benign "some were skipped" report.
  const [notice, setNotice] = useState<string | null>(null);

  const visible = useMemo(
    () => suggestions.filter((s) => !dismissed.has(s.instanceId)),
    [suggestions, dismissed],
  );
  const selected = useMemo(
    () => visible.filter((s) => !unchecked.has(s.instanceId)),
    [visible, unchecked],
  );

  // Keep rendering when the list empties but a notice is pending, so a partial-skip report is
  // readable — confirming the last suggestions removes them from the refreshed list.
  if (visible.length === 0 && !notice) return null;

  const allSelected = selected.length === visible.length;

  const toggle = (instanceId: string) =>
    setUnchecked((prev) => {
      const next = new Set(prev);
      if (next.has(instanceId)) next.delete(instanceId);
      else next.add(instanceId);
      return next;
    });

  const toggleAll = () =>
    setUnchecked(allSelected ? new Set(visible.map((s) => s.instanceId)) : new Set());

  const dismiss = (instanceId: string) => setDismissed((prev) => new Set(prev).add(instanceId));

  const confirmSelected = () => {
    setNotice(null);
    if (selected.length === 0) return;
    startTransition(async () => {
      const res = await confirmBillPayments(
        selected.map((s) => ({
          instanceId: s.instanceId,
          transactionId: s.transactionId,
          paidAmount: s.transactionAmount,
          paidAt: s.transactionDate,
        })),
      );
      if ("error" in res) {
        setNotice(res.error);
        return;
      }
      if (res.skipped > 0) {
        setNotice(
          `Confirmed ${res.confirmed}. Skipped ${res.skipped} that were already paid or linked elsewhere.`,
        );
      }
      // `unchecked` is deliberately NOT reset: it holds the rows the operator rejected as bad
      // matches, and clearing it would re-CHECK them (the set stores unchecked ids, so empty =
      // everything selected) — re-arming a wrong match for the next click. The rows just confirmed
      // drop out of the refreshed list on their own (no longer open, and their transaction is now
      // excluded by linkedTxnIds), so there is nothing here that needs clearing.
      router.refresh();
    });
  };

  // Everything was confirmed away — just report what happened.
  if (visible.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        {notice}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Sparkles className="h-4 w-4 text-amber-500" />
        <h2 className="text-sm font-semibold">Looks like these got paid — confirm?</h2>
        <button
          type="button"
          onClick={toggleAll}
          disabled={isPending}
          className="text-xs text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
        >
          {allSelected ? "Clear all" : "Select all"}
        </button>
        <Button
          size="sm"
          className="ml-auto"
          disabled={isPending || selected.length === 0}
          onClick={confirmSelected}
        >
          <Check className="mr-1 h-3.5 w-3.5" />
          {isPending ? "Confirming…" : `Confirm ${selected.length} selected`}
        </Button>
      </div>

      {notice && <p className="mb-2 text-xs text-muted-foreground">{notice}</p>}

      <ul className="space-y-2">
        {visible.map((s) => {
          const checked = !unchecked.has(s.instanceId);
          return (
            <li
              key={s.instanceId}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-card px-3 py-2"
            >
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(s.instanceId)}
                  disabled={isPending}
                  className="h-4 w-4 shrink-0 rounded border-border"
                  aria-label={`Confirm ${s.billName} paid`}
                />
                <span className="min-w-0 text-sm">
                  <span className="font-medium">{s.billName}</span>{" "}
                  <span className="text-muted-foreground">paid by</span>{" "}
                  <span>{s.transactionVendor ?? s.transactionDescription}</span>{" "}
                  <span className="tabular-nums">{formatCurrency(s.transactionAmount)}</span>{" "}
                  <span className="text-muted-foreground">on {formatBillDate(s.transactionDate)}</span>
                </span>
              </label>
              <Button
                size="sm"
                variant="ghost"
                disabled={isPending}
                title="Dismiss"
                onClick={() => dismiss(s.instanceId)}
              >
                <X className="h-4 w-4" />
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
