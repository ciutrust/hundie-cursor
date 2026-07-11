import type { BillState } from "@/lib/bills/state";

const STATE_STYLES: Record<BillState, { label: string; className: string }> = {
  overdue: {
    label: "Overdue",
    className: "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
  },
  due_soon: {
    label: "Due soon",
    className: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  },
  upcoming: {
    label: "Upcoming",
    className: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  },
  paid: {
    label: "Paid",
    className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  },
  skipped: {
    label: "Skipped",
    className: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  },
};

export function BillStateBadge({ state }: { state: BillState }) {
  const style = STATE_STYLES[state];
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${style.className}`}>
      {style.label}
    </span>
  );
}
