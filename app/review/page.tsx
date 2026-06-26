import { EntitySummaryGrid } from "@/components/review/entity-summary-grid";
import { MonthlyEntityMatrix } from "@/components/review/monthly-entity-matrix";
import { PeriodPicker } from "@/components/review/period-picker";
import { getEntitySummaries, getMonthlyEntityMatrix } from "@/lib/queries/review";
import { parsePeriodParams } from "@/lib/period";
import { formatCurrency } from "@/lib/utils";

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

  const [summaries, monthlyMatrix] = await Promise.all([
    getEntitySummaries(period),
    getMonthlyEntityMatrix(matrixYear),
  ]);

  const grandTotal = summaries
    .filter((summary) => summary.slug !== "unclassified")
    .reduce((sum, summary) => sum + summary.total, 0);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-primary">Expense review</p>
          <h1 className="text-3xl font-semibold tracking-tight">{period.label}</h1>
          <p className="text-sm text-muted-foreground">
            {formatCurrency(grandTotal)} across entities · includes items still uncategorized within each entity
          </p>
        </div>
        <PeriodPicker period={period} />
      </div>

      <EntitySummaryGrid summaries={summaries} period={period} />

      <MonthlyEntityMatrix
        rows={monthlyMatrix}
        year={matrixYear}
        currentYear={currentYear}
        currentMonth={currentMonth}
      />
    </div>
  );
}
