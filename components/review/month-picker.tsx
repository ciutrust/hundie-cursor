"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { monthLabel } from "@/lib/utils";

type MonthPickerProps = {
  year: number;
  month: number;
};

export function MonthPicker({ year, month }: MonthPickerProps) {
  const router = useRouter();

  function navigate(delta: number) {
    const date = new Date(year, month - 1 + delta, 1);
    const next = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    router.push(`/review?month=${next}`);
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={() => navigate(-1)} aria-label="Previous month">
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="min-w-40 text-center text-sm font-medium">{monthLabel(year, month)}</span>
      <Button variant="outline" size="sm" onClick={() => navigate(1)} aria-label="Next month">
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
