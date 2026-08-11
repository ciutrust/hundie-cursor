import { Suspense } from "react";
import { EditableReportRows } from "@/components/reports/editable-report-rows";
import { ReportExportButton } from "@/components/reports/report-export-button";
import { ReportFilters } from "@/components/reports/report-filters";
import { parseReportEntitySlug, parseReportPeriod } from "@/lib/reports/report-params";
import { getReportTransactions, REPORT_TRANSACTIONS_CAP } from "@/lib/queries/reports";
import { getCategoriesByEntity, getClassifiableEntities } from "@/lib/queries/review";
import { activeMonthPeriod } from "@/lib/period";

type Props = {
  searchParams: Promise<{ month?: string; period?: string; at?: string; entity?: string }>;
};

export default async function TransactionsReportPage({ searchParams }: Props) {
  const params = await searchParams;
  const period = parseReportPeriod(params, activeMonthPeriod());
  const entitySlug = parseReportEntitySlug(params);
  const [entities, report, categoriesByEntity] = await Promise.all([
    getClassifiableEntities(),
    getReportTransactions(period, entitySlug),
    getCategoriesByEntity(),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Transaction detail</h1>
          <p className="text-sm text-muted-foreground">
            {period.label} · {report.totalCount.toLocaleString()} rows
            {entitySlug ? ` · ${entitySlug}` : " · all entities"} · categories are editable in
            place
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Suspense fallback={null}>
            <ReportFilters period={period} entities={entities} selectedEntitySlug={entitySlug} />
          </Suspense>
          <ReportExportButton
            period={{ type: period.type, at: period.at, month: params.month }}
            rowCount={report.totalCount}
            periodLabel={period.label}
            entitySlug={entitySlug}
          />
        </div>
      </div>

      {report.capped ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-900/50 dark:bg-amber-950/20">
          <p className="font-semibold">
            Showing the first {REPORT_TRANSACTIONS_CAP.toLocaleString()} of{" "}
            {report.totalCount.toLocaleString()} rows
          </p>
          <p className="mt-1 text-muted-foreground">
            Narrow the period or pick one entity to edit the rest - the CSV export always carries
            everything.
          </p>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Entity</th>
              <th className="px-3 py-2 font-medium">Account</th>
              <th className="px-3 py-2 font-medium">Description</th>
              <th className="px-3 py-2 font-medium">Category</th>
              <th className="px-3 py-2 font-medium text-right">Amount</th>
            </tr>
          </thead>
          <EditableReportRows rows={report.rows} categoriesByEntity={categoriesByEntity} />
        </table>
      </div>
    </div>
  );
}
