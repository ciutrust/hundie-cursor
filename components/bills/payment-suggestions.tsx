"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { confirmBillPayment } from "@/lib/actions/bills";
import { formatCurrency } from "@/lib/utils";
import { formatBillDate } from "./format";
import type { BillPaymentSuggestion } from "@/lib/queries/bills";

export function PaymentSuggestions({ suggestions }: { suggestions: BillPaymentSuggestion[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const visible = suggestions.filter((s) => !dismissed.has(s.instanceId));
  if (visible.length === 0) return null;

  const confirm = (s: BillPaymentSuggestion) =>
    startTransition(async () => {
      await confirmBillPayment({
        instanceId: s.instanceId,
        transactionId: s.transactionId,
        paidAmount: s.transactionAmount,
        paidAt: s.transactionDate,
      });
      router.refresh();
    });

  const dismiss = (instanceId: string) =>
    setDismissed((prev) => new Set(prev).add(instanceId));

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-amber-500" />
        <h2 className="text-sm font-semibold">Looks like these got paid — confirm?</h2>
      </div>
      <ul className="space-y-2">
        {visible.map((s) => (
          <li
            key={s.instanceId}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-card px-3 py-2"
          >
            <p className="min-w-0 flex-1 text-sm">
              <span className="font-medium">{s.billName}</span>{" "}
              <span className="text-muted-foreground">paid by</span>{" "}
              <span>{s.transactionVendor ?? s.transactionDescription}</span>{" "}
              <span className="tabular-nums">{formatCurrency(s.transactionAmount)}</span>{" "}
              <span className="text-muted-foreground">on {formatBillDate(s.transactionDate)}</span>
            </p>
            <div className="flex gap-1">
              <Button size="sm" disabled={isPending} onClick={() => confirm(s)}>
                <Check className="mr-1 h-3.5 w-3.5" /> Confirm
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={isPending}
                title="Dismiss"
                onClick={() => dismiss(s.instanceId)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
