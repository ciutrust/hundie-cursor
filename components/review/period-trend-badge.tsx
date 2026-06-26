import { cn, formatCurrency } from "@/lib/utils";

type PeriodTrendBadgeProps = {
  current: number;
  compareTo: number | null;
  className?: string;
};

export function PeriodTrendBadge({ current, compareTo, className }: PeriodTrendBadgeProps) {
  if (compareTo == null || compareTo === 0) {
    return null;
  }

  const delta = current - compareTo;
  const pct = (delta / compareTo) * 100;
  if (Math.abs(pct) < 1) {
    return <span className={cn("text-xs text-muted-foreground", className)}>flat</span>;
  }

  const up = delta > 0;
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-medium tabular-nums",
        up ? "bg-amber-500/10 text-amber-700" : "bg-emerald-500/10 text-emerald-700",
        className,
      )}
      title={`${up ? "Up" : "Down"} ${Math.abs(pct).toFixed(0)}% vs prior period`}
    >
      {up ? "+" : ""}
      {pct.toFixed(0)}%
    </span>
  );
}

export function formatTrendSummary(current: number, compareTo: number | null) {
  if (compareTo == null || compareTo === 0) return null;
  const delta = current - compareTo;
  return `${delta >= 0 ? "+" : ""}${formatCurrency(delta)} vs prior period`;
}
