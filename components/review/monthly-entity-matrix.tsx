import Link from "next/link";
import type { MonthlyEntityRow } from "@/lib/types/database";
import { MonthTrendIndicator } from "@/components/review/month-trend-indicator";
import { cn, formatCurrency } from "@/lib/utils";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type MonthlyEntityMatrixProps = {
  rows: MonthlyEntityRow[];
  year: number;
  currentYear: number;
  currentMonth: number;
};

export function MonthlyEntityMatrix({ rows, year, currentYear, currentMonth }: MonthlyEntityMatrixProps) {
  if (rows.length === 0) return null;

  const visibleMonths = MONTH_LABELS.map((label, index) => ({
    label,
    month: index + 1,
    isFuture: year > currentYear || (year === currentYear && index + 1 > currentMonth),
  }));

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium">{year} by month</h2>
        <p className="text-xs text-muted-foreground">
          ↑ higher · ↓ lower vs prior month. Next-month arrows hidden for future months.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-4 py-2 font-medium">Entity</th>
              {visibleMonths.map((item) => (
                <th key={item.month} className={cn("px-2 py-2 font-medium", item.isFuture && "opacity-40")}>
                  {item.label}
                </th>
              ))}
              <th className="px-4 py-2 font-medium">YTD</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.slug}>
                <td className="px-4 py-3 font-medium">{row.name}</td>
                {visibleMonths.map((item) => {
                  const total = row.months[item.month] ?? 0;
                  const prev = item.month > 1 ? (row.months[item.month - 1] ?? 0) : null;
                  const nextMonth = item.month + 1;
                  const nextIsFuture =
                    nextMonth > 12 || year > currentYear || (year === currentYear && nextMonth > currentMonth);
                  const next = !nextIsFuture && nextMonth <= 12 ? (row.months[nextMonth] ?? 0) : null;
                  const monthParam = `${year}-${String(item.month).padStart(2, "0")}`;
                  const href = `/review/${row.slug}?month=${monthParam}`;

                  return (
                    <td key={item.month} className={cn("px-2 py-3", item.isFuture && "opacity-40")}>
                      {item.isFuture ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <Link href={href} className="block rounded-sm hover:bg-accent/50">
                          <div>{formatCurrency(total)}</div>
                          <div className="mt-0.5 flex items-center gap-2">
                            <MonthTrendIndicator current={total} compareTo={prev} label="last month" />
                            {next != null ? (
                              <MonthTrendIndicator current={total} compareTo={next} label="next month" />
                            ) : null}
                          </div>
                        </Link>
                      )}
                    </td>
                  );
                })}
                <td className="px-4 py-3 font-medium">{formatCurrency(row.ytd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
