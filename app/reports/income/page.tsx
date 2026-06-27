import { Suspense } from "react";
import { ReportFilters } from "@/components/reports/report-filters";
import { parseReportPeriod } from "@/lib/reports/report-params";
import { getIncomeSummary } from "@/lib/queries/income";
import { getClassifiableEntities } from "@/lib/queries/review";
import { ytdPeriod } from "@/lib/period";
import { formatCurrency } from "@/lib/utils";

type IncomeReportProps = {
  searchParams: Promise<{ month?: string; period?: string; at?: string }>;
};

export default async function IncomeReportPage({ searchParams }: IncomeReportProps) {
  const params = await searchParams;
  const period = parseReportPeriod(params, ytdPeriod());

  const [entities, income] = await Promise.all([
    getClassifiableEntities(),
    getIncomeSummary(period),
  ]);

  const withIncome = income.filter((e) => e.incomeTotal > 0);
  const totalIncome = income.reduce((sum, e) => sum + e.incomeTotal, 0);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-primary">Reports</p>
          <h1 className="text-3xl font-semibold tracking-tight">Money in</h1>
          <p className="text-sm text-muted-foreground">
            Income by source per entity · {period.label}. Expense categorization stays the primary view —
            this is the money-in lens.
          </p>
        </div>
        <Suspense fallback={null}>
          <ReportFilters period={period} entities={entities} selectedEntitySlug={undefined} />
        </Suspense>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <p className="text-xs text-muted-foreground">Total income · {period.label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{formatCurrency(totalIncome)}</p>
      </div>

      {withIncome.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No income captured yet for {period.label}. Income appears here once deposits are backfilled or
          synced and classified into an income category.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {withIncome.map((entity) => (
            <div key={entity.slug} className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-semibold">{entity.name}</h2>
                <span className="text-lg font-semibold tabular-nums">{formatCurrency(entity.incomeTotal)}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                income {formatCurrency(entity.incomeTotal)} · expenses {formatCurrency(entity.expenseTotal)} ·{" "}
                <span className={entity.net >= 0 ? "font-medium text-primary" : "font-medium text-destructive"}>
                  net {formatCurrency(entity.net)}
                </span>
              </p>
              <ul className="mt-3 space-y-1 border-t border-border pt-2 text-sm">
                {entity.byCategory.map((row) => (
                  <li key={row.category} className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">{row.category}</span>
                    <span className="tabular-nums">{formatCurrency(row.total)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
