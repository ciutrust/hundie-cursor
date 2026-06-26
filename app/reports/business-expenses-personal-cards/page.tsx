import Link from "next/link";
import { Suspense } from "react";
import { PeriodPicker } from "@/components/review/period-picker";
import { PersonalCardBusinessReportView } from "@/components/reports/personal-card-business-report";
import { PrintReportButton } from "@/components/reports/print-report-button";
import { PersonalCardBusinessExportButton } from "@/components/reports/personal-card-business-export-button";
import { parsePeriodParams } from "@/lib/period";
import { getPersonalCardBusinessReport } from "@/lib/queries/personal-card-business-report";

type PageProps = {
  searchParams: Promise<{ month?: string; period?: string; at?: string }>;
};

export default async function BusinessExpensesPersonalCardsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const period = parsePeriodParams(params);
  const report = await getPersonalCardBusinessReport(period);

  return (
    <div className="space-y-8 print:space-y-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between print:hidden">
        <div className="space-y-1">
          <p className="text-sm font-medium text-primary">Reports</p>
          <h1 className="text-3xl font-semibold tracking-tight">Business expenses on personal cards</h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            GBSL-classified charges on personal credit cards — not bank transfers or checking activity.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:items-end">
          <Suspense fallback={null}>
            <PeriodPicker period={period} />
          </Suspense>
          <div className="flex flex-wrap gap-2">
            <PersonalCardBusinessExportButton
              period={{ type: period.type, at: period.at, month: params.month }}
              periodLabel={period.label}
            />
            <PrintReportButton title={`Business Expenses on Personal Cards — ${period.label}`} />
          </div>
        </div>
      </div>

      <div className="hidden print:block">
        <h1 className="text-2xl font-semibold">Business Expenses on Personal Cards</h1>
        <p className="text-sm text-muted-foreground">{period.label}</p>
      </div>

      <div className="flex flex-wrap gap-4 text-sm print:hidden">
        <Link href="/reports" className="text-primary hover:underline">
          ← Entity totals
        </Link>
        <Link href="/reports/reconcile" className="text-primary hover:underline">
          GBSL checking reconciliation
        </Link>
      </div>

      <PersonalCardBusinessReportView
        rows={report.rows}
        grandTotal={report.grandTotal}
        transactionCount={report.transactionCount}
      />
    </div>
  );
}
