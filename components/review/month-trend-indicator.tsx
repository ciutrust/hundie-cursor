import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

type MonthTrendIndicatorProps = {
  current: number;
  compareTo: number | null;
  label: string;
  className?: string;
};

function TrendIcon({ current, compareTo }: { current: number; compareTo: number }) {
  if (current < compareTo) {
    return <ArrowDown className="h-3.5 w-3.5 text-emerald-600" aria-hidden />;
  }
  if (current > compareTo) {
    return <ArrowUp className="h-3.5 w-3.5 text-amber-600" aria-hidden />;
  }
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />;
}

function trendText(current: number, compareTo: number, label: string): string {
  if (current < compareTo) return `Lower than ${label}`;
  if (current > compareTo) return `Higher than ${label}`;
  return `Same as ${label}`;
}

export function MonthTrendIndicator({
  current,
  compareTo,
  label,
  className,
}: MonthTrendIndicatorProps) {
  if (compareTo == null) {
    return null;
  }

  return (
    <span
      className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground", className)}
      title={trendText(current, compareTo, label)}
    >
      <TrendIcon current={current} compareTo={compareTo} />
      <span className="sr-only">{trendText(current, compareTo, label)}</span>
    </span>
  );
}
