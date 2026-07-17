import Link from "next/link";
import { Clock } from "lucide-react";
import type { StaleCaptureRow } from "@/lib/queries/stale-captures";
import { formatCurrency } from "@/lib/utils";

function daysWaiting(capturedAt: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(capturedAt).getTime()) / 864e5));
}

/**
 * Nudge for card captures whose charge should have posted by now. Each one is a report line that
 * could double-count (receipt + charge both counted) or a reconcile the user forgot. Renders
 * nothing when there is nothing stale - the happy path costs zero pixels.
 */
export function StaleCaptureBanner({ captures }: { captures: StaleCaptureRow[] }) {
  if (captures.length === 0) return null;

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
      <div className="mb-3 flex items-center gap-2">
        <Clock className="h-4 w-4 text-amber-500" />
        <h2 className="text-sm font-semibold">
          {captures.length === 1
            ? "1 receipt still waiting for its charge"
            : `${captures.length} receipts still waiting for their charge`}
        </h2>
      </div>
      <ul className="space-y-2">
        {captures.map((capture) => {
          const days = daysWaiting(capture.captured_at);
          return (
            <li
              key={capture.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-card px-3 py-2"
            >
              <p className="min-w-0 flex-1 text-sm">
                <span className="font-medium">{capture.vendor ?? "No vendor"}</span>{" "}
                {capture.amount != null ? (
                  <span className="tabular-nums">{formatCurrency(capture.amount)}</span>
                ) : null}{" "}
                <span className="text-muted-foreground">
                  {days} day{days === 1 ? "" : "s"} waiting
                </span>
              </p>
              {capture.expense_report_id && capture.expense_report ? (
                <Link
                  href={`/expense-reports/${capture.expense_report.number}?reconcile=${capture.id}`}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  Find the charge
                </Link>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
