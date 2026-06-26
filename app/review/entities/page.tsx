import { Suspense } from "react";
import { PeriodPicker } from "@/components/review/period-picker";
import { EntityHomeCards } from "@/components/review/entity-home-cards";
import { getAllEntityHomeStats } from "@/lib/queries/entity-home";
import { parsePeriodParams, ytdPeriod } from "@/lib/period";

type EntitiesOverviewPageProps = {
  searchParams: Promise<{ month?: string; period?: string; at?: string }>;
};

export default async function EntitiesOverviewPage({ searchParams }: EntitiesOverviewPageProps) {
  const params = await searchParams;
  const period = parsePeriodParams(params, ytdPeriod());
  const stats = await getAllEntityHomeStats(period);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Classify · Entities
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">All entities</h1>
          <p className="text-sm text-muted-foreground">
            {period.label} · click Uncategorized to classify · details in Reports
          </p>
        </div>
        <Suspense fallback={null}>
          <PeriodPicker period={period} />
        </Suspense>
      </div>

      <div className="space-y-10">
        {stats.map((entityStats) => (
          <EntityHomeCards key={entityStats.slug} stats={entityStats} period={period} />
        ))}
      </div>
    </div>
  );
}
