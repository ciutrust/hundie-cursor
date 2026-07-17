import Link from "next/link";
import { notFound } from "next/navigation";
import { CaptureMatchPrompts } from "@/components/reconcile/capture-match-prompts";
import { getCaptureMatchPromptForCapture } from "@/components/reconcile/actions";
import { DeleteReportButton } from "@/components/expense-reports/delete-report-button";
import { ReportLines } from "@/components/expense-reports/report-lines";
import { ReportLinesExport } from "@/components/expense-reports/report-lines-export";
import { ReportPaidToggle } from "@/components/expense-reports/report-paid-toggle";
import { formatExpenseReportNumber } from "@/lib/date-range";
import type { ExpenseReportLine } from "@/lib/expense-report-lines";
import { signCapturePhotoUrls } from "@/lib/queries/expense-captures";
import { getExpenseReportByNumber } from "@/lib/queries/expense-reports";
import { formatCurrency } from "@/lib/utils";

type ExpenseReportPageProps = {
  params: Promise<{ number: string }>;
  /** `?reconcile=<captureId>` — the "Find the charge" link on an awaiting-charge line lands here. */
  searchParams: Promise<{ reconcile?: string }>;
};

/** The trip's span, from the lines themselves — a report has no dates of its own. */
function tripDateRange(lines: ExpenseReportLine[]): string | null {
  if (lines.length === 0) return null;
  const dates = lines.map((line) => line.date);
  const start = dates.reduce((min, date) => (date < min ? date : min));
  const end = dates.reduce((max, date) => (date > max ? date : max));
  return start === end ? start : `${start} to ${end}`;
}

export default async function ExpenseReportPage({ params, searchParams }: ExpenseReportPageProps) {
  const { number } = await params;
  const { reconcile } = await searchParams;

  // The URL may be padded ("0001") or bare ("1") — both address the same report. Digits-only so a
  // hand-edited "1-foo" 404s instead of silently resolving to report 1 the way parseInt alone would.
  const reportNumber = /^\d+$/.test(number) ? Number.parseInt(number, 10) : Number.NaN;
  if (!Number.isInteger(reportNumber)) notFound();

  const result = await getExpenseReportByNumber(reportNumber);
  if (!result) notFound();
  const { report, lines, totals } = result;

  // "Find the charge" on an awaiting-charge line deep-links back here with ?reconcile=<captureId>.
  // Scoped to this report's own lines so a hand-edited id can't pull an unrelated capture onto the page.
  const reconcileTarget =
    reconcile && lines.some((line) => line.kind === "capture" && line.id === reconcile)
      ? reconcile
      : null;
  const matchPrompt = reconcileTarget ? await getCaptureMatchPromptForCapture(reconcileTarget) : null;

  // The receipts bucket is private. Sign every photo on the page in ONE batch (a standalone capture's
  // own photo, plus the photo a reconciled capture lends to its charge) and hand the client plain URLs.
  const photoPaths = lines.flatMap((line) =>
    [line.capture?.photoPath, line.enrichedBy?.photoPath].filter(
      (path): path is string => typeof path === "string" && path.length > 0,
    ),
  );
  const signed = await signCapturePhotoUrls(photoPaths);
  const photoUrls = Object.fromEntries(signed);

  const label = formatExpenseReportNumber(report.number);
  const range = tripDateRange(lines);

  return (
    <div className="space-y-8">
      {/* A div, not <header> — the print stylesheet hides header/nav/aside as app chrome. */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground print:hidden">
            <Link href="/expense-reports" className="hover:text-foreground">
              Expense reports
            </Link>
            {` · ${label}`}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            {`Expense Report ${label} · ${report.name}`}
          </h1>
          {range ? <p className="text-sm text-muted-foreground tabular-nums">{range}</p> : null}
          {/* Both numbers AC asked for. The trip total is what the trip COST and never moves as he
              ticks lines off; expensed is how much of it he has actually filed. */}
          <p className="pt-1 text-sm">
            <span className="font-semibold tabular-nums text-foreground">
              {formatCurrency(totals.total)}
            </span>
            <span className="text-muted-foreground"> trip total · </span>
            <span className="font-semibold tabular-nums text-foreground">
              {formatCurrency(totals.expensedTotal)}
            </span>
            <span className="text-muted-foreground">
              {` expensed (${totals.expensedCount} of ${totals.count} line${totals.count === 1 ? "" : "s"})`}
            </span>
          </p>
          {report.notes ? (
            <p className="max-w-prose pt-1 text-sm text-muted-foreground">{report.notes}</p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-start gap-2 print:hidden">
          <ReportPaidToggle id={report.id} paidAt={report.paid_at} />
          <ReportLinesExport lines={lines} filename={`expense-report-${label}.csv`} />
          <DeleteReportButton id={report.id} label={`Expense Report ${label}`} />
        </div>
      </div>

      {/* Landed here from "Find the charge": offer the match for that one receipt. Never auto-matches
          — when the matcher can't separate two charges it makes him pick. */}
      {matchPrompt ? <CaptureMatchPrompts prompts={[matchPrompt]} /> : null}

      {lines.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="font-medium">Nothing in this report yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add charges from{" "}
            <Link href="/transactions" className="text-primary hover:underline">
              Transactions
            </Link>
            , snap a receipt on the capture screen, or delete the report.
          </p>
        </div>
      ) : (
        <ReportLines lines={lines} reportNumber={report.number} photoUrls={photoUrls} />
      )}
    </div>
  );
}
