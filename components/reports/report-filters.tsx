"use client";

import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PeriodPicker } from "@/components/review/period-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { periodQueryString, type PeriodRange } from "@/lib/period";

type ReportFiltersProps = {
  period: PeriodRange;
  entities: Array<{ slug: string; name: string }>;
  selectedEntitySlug?: string;
  showEntityFilter?: boolean;
  periodDefault?: PeriodRange;
};

function ReportFiltersInner({
  period,
  entities,
  selectedEntitySlug,
  showEntityFilter = true,
}: ReportFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function pushParams(extra: Record<string, string | undefined>) {
    const merged: Record<string, string> = {};
    for (const [key, value] of searchParams.entries()) {
      if (!["period", "at", "month", "entity"].includes(key)) {
        merged[key] = value;
      }
    }
    for (const [key, value] of Object.entries(extra)) {
      if (value != null && value !== "") merged[key] = value;
    }
    router.push(`${pathname}?${periodQueryString(period, merged)}`);
  }

  function onEntityChange(slug: string) {
    pushParams({ entity: slug === "all" ? undefined : slug });
  }

  return (
    <div className="flex flex-wrap items-end gap-4">
      {showEntityFilter ? (
        <div className="min-w-[180px] space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Entity</p>
          <Select value={selectedEntitySlug ?? "all"} onValueChange={onEntityChange}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="All entities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All entities</SelectItem>
              {entities.map((entity) => (
                <SelectItem key={entity.slug} value={entity.slug}>
                  {entity.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <PeriodPicker period={period} />
    </div>
  );
}

export function ReportFilters(props: ReportFiltersProps) {
  return (
    <Suspense fallback={null}>
      <ReportFiltersInner {...props} />
    </Suspense>
  );
}
