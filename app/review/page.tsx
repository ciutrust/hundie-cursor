import { AppHeader } from "@/components/layout/app-header";
import { EntitySummaryGrid } from "@/components/review/entity-summary-grid";
import { MonthlyEntityMatrix } from "@/components/review/monthly-entity-matrix";
import { MonthPicker } from "@/components/review/month-picker";
import { ReviewNav } from "@/components/review/review-nav";
import { getEntitySummaries, getMonthlyEntityMatrix } from "@/lib/queries/review";
import { formatCurrency, monthLabel, parseMonthParam } from "@/lib/utils";

type ReviewPageProps = {
  searchParams: Promise<{ month?: string }>;
};

export default async function ReviewPage({ searchParams }: ReviewPageProps) {
  const params = await searchParams;
  const { year, month } = parseMonthParam(params.month);
  const monthParam = `${year}-${String(month).padStart(2, "0")}`;
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const [summaries, monthlyMatrix] = await Promise.all([
    getEntitySummaries(year, month),
    getMonthlyEntityMatrix(year),
  ]);

  const grandTotal = summaries
    .filter((summary) => summary.slug !== "unclassified")
    .reduce((sum, summary) => sum + summary.total, 0);

  return (
    <div className="min-h-screen bg-background">
      <AppHeader title="Monthly review" />
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        <ReviewNav />

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold">{monthLabel(year, month)}</h2>
            <p className="text-sm text-muted-foreground">
              Total expenses: {formatCurrency(grandTotal)} · all assigned transactions (includes items still
              uncategorized within each entity)
            </p>
          </div>
          <MonthPicker year={year} month={month} />
        </div>

        <EntitySummaryGrid summaries={summaries} month={monthParam} />

        <MonthlyEntityMatrix
          rows={monthlyMatrix}
          year={year}
          currentYear={currentYear}
          currentMonth={currentMonth}
        />
      </main>
    </div>
  );
}
