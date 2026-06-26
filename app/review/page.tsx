import { Suspense } from "react";
import { DormantEntitiesCard } from "@/components/review/dormant-entities-card";
import { EntityCardGrid } from "@/components/review/entity-card-grid";
import { MonthlyEntityMatrix } from "@/components/review/monthly-entity-matrix";
import { PeriodPicker } from "@/components/review/period-picker";
import { ReviewKpiStrip } from "@/components/review/review-kpi-strip";
import { SpendingTrendsSection } from "@/components/review/spending-trends-section";
import {
  getDormantEntities,
  getEntitySummaries,
  getMonthlyEntityMatrix,
  getReviewDashboardStats,
} from "@/lib/queries/review";
import { parsePeriodParams } from "@/lib/period";

type ReviewPageProps = {
  searchParams: Promise<{ month?: string; period?: string; at?: string }>;
};

export default async function ReviewPage({ searchParams }: ReviewPageProps) {
  const params = await searchParams;
  const period = parsePeriodParams(params);
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const matrixYear = period.type === "year" ? Number(period.at) : Number(period.start.slice(0, 4));

  const [summaries, monthlyMatrix, stats, dormantEntities] = await Promise.all([
    getEntitySummaries(period),
    getMonthlyEntityMatrix(matrixYear),
    getReviewDashboardStats(period),
    getDormantEntities(),
  ]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Classify · Review
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">{period.label} review</h1>
        </div>
        <Suspense fallback={null}>
          <PeriodPicker period={period} />
        </Suspense>
      </div>

      <ReviewKpiStrip stats={stats} />

      <EntityCardGrid summaries={summaries} period={period} />

      <DormantEntitiesCard entities={dormantEntities} />

      <SpendingTrendsSection title={`${matrixYear} spending trends`}>
        <MonthlyEntityMatrix
          rows={monthlyMatrix}
          year={matrixYear}
          currentYear={currentYear}
          currentMonth={currentMonth}
          filterSlugs={summaries
            .filter((summary) => summary.slug !== "unclassified")
            .map((summary) => summary.slug)}
          embedded
        />
      </SpendingTrendsSection>
    </div>
  );
}
