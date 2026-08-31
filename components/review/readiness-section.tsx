import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import type { OpenMonthCell, ReadinessSummary } from "@/lib/queries/dashboard";
import { UNASSIGNED_MONTH_CLOSE_SLUG } from "@/lib/queries/review";

const MAX_CELLS_PER_ENTITY = 12;

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function monthLabel(year: number, month: number) {
  return new Date(year, month - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

type EntityGroup = { slug: string; name: string; cells: OpenMonthCell[] };

function groupByEntity(cells: OpenMonthCell[]): EntityGroup[] {
  const groups = new Map<string, EntityGroup>();
  for (const cell of cells) {
    const group = groups.get(cell.entitySlug) ?? { slug: cell.entitySlug, name: cell.entityName, cells: [] };
    group.cells.push(cell);
    groups.set(cell.entitySlug, group);
  }
  return [...groups.values()];
}

/**
 * "Which entity/months are not ready" — every open (entity, month) cell in the period, each with a
 * deep link into that entity's month (the month-close link contract). Orphan (failed-to-book) counts
 * are deliberately NOT links: classifying can't clear them (re-run the import heal), and the
 * "__unassigned__" pseudo-row has no /review page at all.
 */
export function ReadinessSection({ readiness, periodLabel }: { readiness: ReadinessSummary; periodLabel: string }) {
  const groups = groupByEntity(readiness.openCells);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Months not ready</h2>
          <p className="text-sm text-muted-foreground">
            {readiness.openCells.length === 0
              ? `Every active month in ${periodLabel} is closed`
              : `${readiness.openMonthCount} month${readiness.openMonthCount === 1 ? "" : "s"} with open work · ${periodLabel}`}
          </p>
        </div>
        <Link href="/tax-close" className="text-sm font-medium text-primary hover:underline">
          Tax close →
        </Link>
      </div>

      {readiness.openCells.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-4 py-3 text-sm font-medium text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          All caught up — every entity with activity is at zero backlog for {periodLabel}.
        </div>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {groups.map((group) => {
            const visible = group.cells.slice(0, MAX_CELLS_PER_ENTITY);
            const overflow = group.cells.slice(MAX_CELLS_PER_ENTITY);
            const linkable = group.slug !== UNASSIGNED_MONTH_CLOSE_SLUG;
            return (
              <div key={group.slug} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <span className="shrink-0 pt-0.5 font-medium">{group.name}</span>
                <div className="flex flex-wrap justify-start gap-1.5 sm:justify-end">
                  {visible.map((cell) => (
                    <span
                      key={`${cell.year}-${cell.month}`}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/20 py-1 pl-2 pr-1 text-xs"
                    >
                      <span className="font-medium">{monthLabel(cell.year, cell.month)}</span>
                      {cell.backlogCount > 0 ? (
                        linkable ? (
                          <Link
                            href={`/review/${group.slug}?period=month&at=${cell.year}-${pad2(cell.month)}`}
                            className="rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-amber-700 hover:bg-amber-500/25 dark:text-amber-400"
                          >
                            {cell.backlogCount} left →
                          </Link>
                        ) : (
                          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-amber-700 dark:text-amber-400">
                            {cell.backlogCount} left
                          </span>
                        )
                      ) : null}
                      {cell.orphanCount > 0 ? (
                        <span
                          className="rounded-full bg-red-500/15 px-2 py-0.5 font-medium text-red-700 dark:text-red-400"
                          title="Transactions with no classification (import failed to book them). Re-run the import heal to fix."
                        >
                          {cell.orphanCount} failed to book
                        </span>
                      ) : null}
                    </span>
                  ))}
                  {overflow.length > 0 ? (
                    <Link
                      href={`/tax-close?year=${overflow[0].year}`}
                      className="inline-flex items-center rounded-lg border border-border bg-muted/20 px-2 py-1 text-xs font-medium text-primary hover:underline"
                    >
                      +{overflow.length} more →
                    </Link>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
