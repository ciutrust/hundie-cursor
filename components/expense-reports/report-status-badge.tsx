import { cn } from "@/lib/utils";

/**
 * A report's filing status. Green = the reimbursement landed, amber = money still owed to AC.
 * Pure and server-safe so the list table can render it without shipping JS.
 */
export function ReportStatusBadge({ paidAt, className }: { paidAt: string | null; className?: string }) {
  const paid = Boolean(paidAt);
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
        paid
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
          : "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
        className,
      )}
    >
      {paid ? "Paid" : "Unpaid"}
    </span>
  );
}
