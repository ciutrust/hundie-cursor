import Link from "next/link";
import { CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react";
import { getMonthCloseMatrix } from "@/lib/queries/review";
import { cellStatus, rollupStatus } from "@/lib/month-close";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function shiftMonth(at: string, delta: number) {
  const [y, m] = at.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}
function monthLabel(at: string) {
  const [y, m] = at.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

type Props = { searchParams: Promise<{ at?: string }> };

export default async function MonthClosePage({ searchParams }: Props) {
  const params = await searchParams;
  const now = new Date();
  const at = /^\d{4}-\d{2}$/.test(params.at ?? "")
    ? (params.at as string)
    : `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
  const [year, month] = at.split("-").map(Number);

  const matrix = await getMonthCloseMatrix(year);
  const rows = matrix.map((row) => ({ slug: row.slug, name: row.name, cell: row.months[month] }));
  const active = rows.filter((row) => row.cell.hasActivity);
  const readyCount = active.filter((row) => cellStatus(row.cell) === "closed").length;
  const status = rollupStatus(active.map((row) => row.cell));

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Tax readiness · Month close
          </p>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            <h1 className="text-3xl font-semibold tracking-tight">{monthLabel(at)}</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            A month is closed when every entity with activity is at zero backlog (0 unclassified + 0
            Ask My Accountant).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/month-close?at=${shiftMonth(at, -1)}`}
            className="rounded-md border border-border bg-card p-2 hover:bg-muted/30"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <Link
            href={`/month-close?at=${shiftMonth(at, 1)}`}
            className="rounded-md border border-border bg-card p-2 hover:bg-muted/30"
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {status === "closed" ? (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-4 py-3 text-sm font-medium text-emerald-700 dark:text-emerald-400">
          ✓ Month closed — every active entity is at zero backlog for {monthLabel(at)}.
        </div>
      ) : status === "open" ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm">
          <strong>{readyCount} of {active.length}</strong> entities ready — clear the rest to close{" "}
          {monthLabel(at)}.
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
          No activity in {monthLabel(at)}.
        </div>
      )}

      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {rows.map((row) => {
          const cs = cellStatus(row.cell);
          return (
            <div key={row.slug} className="flex items-center justify-between gap-4 px-4 py-3">
              <span className="font-medium">{row.name}</span>
              {cs === "closed" ? (
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" /> Closed
                </span>
              ) : cs === "open" ? (
                <Link
                  href={`/review/${row.slug}?period=month&at=${at}`}
                  className="rounded-full bg-amber-500/15 px-2.5 py-1 text-sm font-medium text-amber-700 hover:bg-amber-500/25 dark:text-amber-400"
                >
                  {row.cell.backlogCount} left →
                </Link>
              ) : (
                <span className="text-sm text-muted-foreground">— no activity</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
