"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { parsePeriodParams, periodQueryString, shiftPeriod, type PeriodRange, type PeriodType } from "@/lib/period";

const PERIOD_TYPES: { value: PeriodType; label: string }[] = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "year", label: "Year" },
];

type PeriodPickerProps = {
  period: PeriodRange;
};

export function PeriodPicker({ period }: PeriodPickerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function pushRange(next: PeriodRange) {
    const extra: Record<string, string> = {};
    for (const [key, value] of searchParams.entries()) {
      if (!["period", "at", "month"].includes(key)) {
        extra[key] = value;
      }
    }
    router.push(`${pathname}?${periodQueryString(next, extra)}`);
  }

  function changeType(type: PeriodType) {
    const current = parsePeriodParams({
      period: type,
      at:
        type === "year"
          ? period.start.slice(0, 4)
          : type === "quarter"
            ? `${period.start.slice(0, 4)}-Q${Math.floor((Number(period.start.slice(5, 7)) - 1) / 3) + 1}`
            : type === "week"
              ? period.start
              : period.start.slice(0, 7),
    });
    pushRange(current);
  }

  return (
    <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
      <div className="inline-flex rounded-lg border border-border bg-muted/50 p-0.5 dark:bg-muted/30">
        {PERIOD_TYPES.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => changeType(item.value)}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              period.type === item.value
                ? "bg-background text-foreground shadow-sm ring-1 ring-border dark:bg-card"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-1 py-1 sm:justify-start">
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => pushRange(shiftPeriod(period, -1))} aria-label="Previous period">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-36 text-center text-sm font-medium">{period.label}</span>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => pushRange(shiftPeriod(period, 1))} aria-label="Next period">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
