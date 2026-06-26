import Link from "next/link";
import { Suspense } from "react";
import { PeriodPicker } from "@/components/review/period-picker";
import { PrintReportButton } from "@/components/reports/print-report-button";
import { parsePeriodParams } from "@/lib/period";
import { getGbslCheckingReconciliation } from "@/lib/queries/reconcile";
import { formatCurrency } from "@/lib/utils";

type ReconcilePageProps = {
  searchParams: Promise<{ month?: string; period?: string; at?: string }>;
};

export default async function ReconcilePage({ searchParams }: ReconcilePageProps) {
  const params = await searchParams;
  const period = parsePeriodParams(params);
  const { summary, rows } = await getGbslCheckingReconciliation(period);
  const unmatched = rows.filter((r) => r.match_status !== "matched");

  return (
    <div className="space-y-8 print:space-y-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between print:hidden">
        <div className="space-y-1">
          <p className="text-sm font-medium text-primary">Reports</p>
          <h1 className="text-3xl font-semibold tracking-tight">GBSL Checking reconciliation</h1>
          <p className="text-sm text-muted-foreground">{period.label} · WF GBSL Checking vs QBO Navigate 3196</p>
        </div>
        <div className="flex flex-col gap-3 sm:items-end">
          <Suspense fallback={null}>
            <PeriodPicker period={period} />
          </Suspense>
          <PrintReportButton title={`GBSL Checking Reconciliation — ${period.label}`} />
        </div>
      </div>

      <div className="hidden print:block">
        <h1 className="text-2xl font-semibold">GBSL Checking Reconciliation</h1>
        <p className="text-sm text-muted-foreground">{period.label}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Ledger debits" value={String(summary.ledgerCount)} />
        <Stat label="QBO expenses" value={String(summary.qboCount)} />
        <Stat label="Matched" value={`${summary.matchedCount} (${(summary.matchRate * 100).toFixed(1)}%)`} />
        <Stat label="Needs review" value={String(summary.ledgerOnlyCount + summary.qboOnlyCount)} />
      </div>

      <div className="flex gap-4 text-sm print:hidden">
        <Link href="/reports" className="text-primary hover:underline">
          ← Entity totals
        </Link>
        <Link href="/reports/business-expenses-personal-cards" className="text-primary hover:underline">
          Business expenses on personal cards
        </Link>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Amount</th>
              <th className="px-4 py-3 font-medium">Description</th>
              <th className="px-4 py-3 font-medium">Category</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {unmatched.map((row, index) => (
              <tr key={`${row.match_status}-${row.transaction_date}-${index}`}>
                <td className="px-4 py-3">
                  <StatusBadge status={row.match_status} />
                </td>
                <td className="px-4 py-3 tabular-nums">{row.transaction_date}</td>
                <td className="px-4 py-3 tabular-nums">{formatCurrency(row.amount)}</td>
                <td className="max-w-md truncate px-4 py-3" title={row.description}>
                  {row.description}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{row.category_name ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {unmatched.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">All rows matched for this period.</p>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const label =
    status === "ledger_only" ? "Ledger only" : status === "qbo_only" ? "QBO only" : "Matched";
  const className =
    status === "matched"
      ? "text-emerald-600"
      : status === "ledger_only"
        ? "text-amber-600"
        : "text-destructive";
  return <span className={`font-medium ${className}`}>{label}</span>;
}
