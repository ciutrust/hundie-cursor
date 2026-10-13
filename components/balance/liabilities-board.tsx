"use client";

import { cn, formatCurrency } from "@/lib/utils";
import { useStoredView, ViewToggle } from "./view-toggle";

export type LiabilityCard = {
  id: string;
  name: string;
  type: string;
  entity: string;
  balance: number;
  apr: number | null;
  updatedLabel: string;
  stale: boolean;
};

function label(type: string) {
  return type.replaceAll("_", " ");
}

function LiabilityItem({ item, view }: { item: LiabilityCard; view: "grid" | "list" }) {
  return (
    <article
      className={cn(
        "rounded-xl border border-border bg-card p-4",
        view === "grid" ? "flex min-h-44 flex-col justify-between" : "flex flex-col gap-3 sm:flex-row sm:items-center",
      )}
    >
      <div className={cn("min-w-0", view === "list" && "sm:flex-1")}>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label(item.type)}
        </p>
        <h2 className="mt-1 text-sm font-semibold leading-snug">{item.name}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{item.entity}</p>
      </div>
      <div className={cn(view === "list" && "sm:text-right")}>
        <p className="text-lg font-semibold tabular-nums">{formatCurrency(item.balance)}</p>
        <p className="text-xs text-muted-foreground">{item.apr != null ? `${item.apr}% APR` : "APR not set"}</p>
        <p className={cn("text-xs", item.stale ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
          {item.updatedLabel}
        </p>
      </div>
    </article>
  );
}


function groupByEntity(items: LiabilityCard[]): [string, LiabilityCard[]][] {
  const groups = new Map<string, LiabilityCard[]>();
  for (const item of items) {
    const list = groups.get(item.entity) ?? [];
    list.push(item);
    groups.set(item.entity, list);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export function LiabilitiesBoard({
  liabilities,
  total,
}: {
  liabilities: LiabilityCard[];
  total: string;
}) {
  const [view, setView] = useStoredView("hundie:liabilities-view");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Liabilities</h1>
          <p className="text-sm text-muted-foreground">Total owed: {total}</p>
        </div>
        <ViewToggle view={view} onChange={setView} />
      </div>
      {liabilities.length === 0 ? (
        <p className="text-sm text-muted-foreground">No liabilities yet.</p>
      ) : (
        <div className="space-y-8">
          {groupByEntity(liabilities).map(([entity, items]) => {
            const subtotal = items.reduce((sum, item) => sum + item.balance, 0);
            return (
              <section key={entity} className="space-y-3">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="text-sm font-semibold">{entity}</h2>
                  <p className="text-xs tabular-nums text-muted-foreground">{formatCurrency(subtotal)}</p>
                </div>
                <div className={view === "grid" ? "grid gap-3 sm:grid-cols-2 xl:grid-cols-3" : "space-y-2"}>
                  {items.map((item) => (
                    <LiabilityItem key={item.id} item={item} view={view} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
