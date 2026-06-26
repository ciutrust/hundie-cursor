import Link from "next/link";
import type { MonthlyCategoryRow } from "@/lib/types/database";
import { periodQueryString, periodRangeFor } from "@/lib/period";
import { cn, formatCurrency } from "@/lib/utils";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type MonthlyCategoryMatrixProps = {
  rows: MonthlyCategoryRow[];
  entitySlug: string;
  year: number;
  currentYear: number;
  currentMonth: number;
};

export function MonthlyCategoryMatrix({
  rows,
  entitySlug,
  year,
  currentYear,
  currentMonth,
}: MonthlyCategoryMatrixProps) {
  if (rows.length === 0) return null;

  const visibleMonths = MONTH_LABELS.map((label, index) => ({
    label,
    month: index + 1,
    isFuture: year > currentYear || (year === currentYear && index + 1 > currentMonth),
  }));

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="border-b border-border px-4 py-4">
        <h2 className="text-sm font-semibold">{year} by category</h2>
        <p className="mt-1 text-xs text-muted-foreground">Click a cell to filter transactions for that category and month.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-left text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">Category</th>
              {visibleMonths.map((item) => (
                <th key={item.month} className={cn("px-2 py-2.5 font-medium", item.isFuture && "opacity-40")}>
                  {item.label}
                </th>
              ))}
              <th className="px-4 py-2.5 font-medium">YTD</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => {
              const categoryParam = row.categoryId ?? "unclassified";
              return (
                <tr
                  key={row.categoryId ?? "unclassified"}
                  className={cn(row.isUnclassified && row.ytdCount > 0 && "bg-destructive/5")}
                >
                  <td className="max-w-[180px] truncate px-4 py-3 font-medium" title={row.categoryName}>
                    {row.categoryName}
                  </td>
                  {visibleMonths.map((item) => {
                    const total = row.months[item.month] ?? 0;
                    const count = row.monthCounts[item.month] ?? 0;
                    const monthAt = `${year}-${String(item.month).padStart(2, "0")}`;
                    const monthPeriod = periodRangeFor("month", monthAt);
                    const href = `/review/${entitySlug}?${periodQueryString(monthPeriod)}&category=${categoryParam}`;

                    return (
                      <td key={item.month} className={cn("px-2 py-3", item.isFuture && "opacity-40")}>
                        {item.isFuture || (total === 0 && count === 0) ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <Link href={href} className="block rounded-md px-1 py-0.5 hover:bg-muted/60">
                            <div className={cn("tabular-nums", row.isUnclassified && count > 0 && "text-destructive")}>
                              {formatCurrency(total)}
                            </div>
                            <div className="text-xs text-muted-foreground">{count} txn{count === 1 ? "" : "s"}</div>
                          </Link>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-4 py-3 font-medium tabular-nums">
                    <div className={cn(row.isUnclassified && row.ytdCount > 0 && "text-destructive")}>
                      {formatCurrency(row.ytd)}
                    </div>
                    {row.ytdCount > 0 ? (
                      <div className="text-xs font-normal text-muted-foreground">
                        {row.ytdCount} txn{row.ytdCount === 1 ? "" : "s"}
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
