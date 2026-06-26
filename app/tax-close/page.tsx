import Link from "next/link";
import { CalendarCheck, ChevronLeft, ChevronRight } from "lucide-react";
import { getMonthCloseMatrix } from "@/lib/queries/review";
import { cellStatus, rollupStatus, summarizeMonths } from "@/lib/month-close";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function pad2(n: number) {
  return String(n).padStart(2, "0");
}

type Props = { searchParams: Promise<{ year?: string }> };

export default async function TaxClosePage({ searchParams }: Props) {
  const params = await searchParams;
  const now = new Date();
  const year = /^\d{4}$/.test(params.year ?? "") ? Number(params.year) : now.getFullYear();

  const matrix = await getMonthCloseMatrix(year);
  const monthNums = Array.from({ length: 12 }, (_, i) => i + 1);
  const monthStatuses = monthNums.map((m) => rollupStatus(matrix.map((row) => row.months[m])));
  const summary = summarizeMonths(monthStatuses);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Tax readiness · Tax close
          </p>
          <div className="flex items-center gap-2">
            <CalendarCheck className="h-5 w-5 text-emerald-500" />
            <h1 className="text-3xl font-semibold tracking-tight">Tax close {year}</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Every month closed (all entities at zero backlog) means the year is ready to hand off.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/tax-close?year=${year - 1}`}
            className="rounded-md border border-border bg-card p-2 hover:bg-muted/30"
            aria-label="Previous year"
          >
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <span className="text-sm font-medium tabular-nums">{year}</span>
          <Link
            href={`/tax-close?year=${year + 1}`}
            className="rounded-md border border-border bg-card p-2 hover:bg-muted/30"
            aria-label="Next year"
          >
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {summary.taxCloseReady ? (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-4 py-3 text-sm font-medium text-emerald-700 dark:text-emerald-400">
          ✓ Tax close ready — all {summary.active} active month(s) closed for {year}.
        </div>
      ) : (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm">
          <strong>{summary.closed} of {summary.active}</strong> months closed · {summary.open} still
          open. Click a cell to clear an entity's month.
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-muted-foreground">
              <th className="px-4 py-2 text-left font-medium">Entity</th>
              {monthNums.map((m, i) => (
                <th
                  key={m}
                  className={`px-2 py-2 text-center font-medium ${
                    monthStatuses[i] === "closed" ? "text-emerald-600 dark:text-emerald-400" : ""
                  }`}
                >
                  {MONTHS[i]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {matrix.map((row) => (
              <tr key={row.slug} className="hover:bg-muted/20">
                <td className="whitespace-nowrap px-4 py-2 font-medium">{row.name}</td>
                {monthNums.map((m) => {
                  const cell = row.months[m];
                  const status = cellStatus(cell);
                  if (status === "closed") {
                    return (
                      <td key={m} className="px-2 py-2 text-center text-emerald-600 dark:text-emerald-400">
                        ✓
                      </td>
                    );
                  }
                  if (status === "open") {
                    return (
                      <td key={m} className="px-2 py-2 text-center">
                        <Link
                          href={`/review/${row.slug}?period=month&at=${year}-${pad2(m)}`}
                          className="inline-block rounded bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium tabular-nums text-amber-700 hover:bg-amber-500/25 dark:text-amber-400"
                          title={`${cell.backlogCount} to classify`}
                        >
                          {cell.backlogCount}
                        </Link>
                      </td>
                    );
                  }
                  return (
                    <td key={m} className="px-2 py-2 text-center text-muted-foreground/40">
                      ·
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        ✓ closed (0 backlog) · <span className="text-amber-600 dark:text-amber-400">amber</span> = rows
        still need a category (click to clear) · · = no activity
      </p>
    </div>
  );
}
