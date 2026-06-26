import Link from "next/link";
import { PeriodTrendBadge } from "@/components/review/period-trend-badge";
import type { ReviewDashboardStats } from "@/lib/types/database";
import { cn, formatCurrency } from "@/lib/utils";

type ReviewKpiStripProps = {
  stats: ReviewDashboardStats;
};

const KPI_ITEMS = [
  { key: "spend", label: "Total spend · all entities", dot: "bg-emerald-500" },
  { key: "unclassified", label: "Unclassified", dot: "bg-orange-500" },
  { key: "aiPreclassified", label: "AI pre-classified", dot: "bg-violet-500" },
  { key: "taxReady", label: "Tax-ready entities", dot: "bg-emerald-500" },
] as const;

export function ReviewKpiStrip({ stats }: ReviewKpiStripProps) {
  const values: Record<(typeof KPI_ITEMS)[number]["key"], React.ReactNode> = {
    spend: (
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums tracking-tight">
          {formatCurrency(stats.grandTotal)}
        </span>
        <PeriodTrendBadge
          current={stats.grandTotal}
          compareTo={stats.previousGrandTotal > 0 ? stats.previousGrandTotal : null}
          className="dark:bg-emerald-500/15 dark:text-emerald-400"
        />
      </div>
    ),
    unclassified: (
      <div>
        <span className="text-2xl font-semibold tabular-nums tracking-tight text-orange-600 dark:text-orange-400">
          {stats.unclassifiedCount}
        </span>
        <p className="mt-1 text-xs text-muted-foreground">
          of {stats.totalTransactions.toLocaleString()} transactions
        </p>
      </div>
    ),
    aiPreclassified: (
      <div>
        <Link
          href="/review/personal?category=unclassified&period=year&at=2025"
          className="group block rounded-lg -m-1 p-1 transition-colors hover:bg-violet-500/5"
        >
          <span className="text-2xl font-semibold tabular-nums tracking-tight text-violet-600 group-hover:underline dark:text-violet-400">
            {stats.aiPreclassifiedCount}
          </span>
          <p className="mt-1 text-xs text-muted-foreground">awaiting your confirm · open AI review</p>
        </Link>
      </div>
    ),
    taxReady: (
      <div>
        <span className="text-2xl font-semibold tabular-nums tracking-tight">
          {stats.taxReadyCount}/{stats.classifiableEntityCount}
        </span>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {stats.taxReadyNames.length > 0 ? stats.taxReadyNames.join(" · ") : "None yet"}
        </p>
      </div>
    ),
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {KPI_ITEMS.map((item) => (
        <div key={item.key} className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <span className={cn("h-2 w-2 rounded-full", item.dot)} />
            <p className="text-xs font-medium text-muted-foreground">{item.label}</p>
          </div>
          {values[item.key]}
        </div>
      ))}
    </div>
  );
}
