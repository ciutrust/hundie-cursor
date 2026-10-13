"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
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

const COLLAPSED_KEY = "hundie:liabilities-collapsed";

function label(type: string) {
  return type.replaceAll("_", " ");
}

function LiabilityItem({ item, view }: { item: LiabilityCard; view: "grid" | "list" }) {
  return (
    <article
      className={cn(
        "rounded-xl border border-border bg-background p-4",
        view === "grid" ? "flex min-h-44 flex-col justify-between" : "flex flex-col gap-3 sm:flex-row sm:items-center",
      )}
    >
      <div className={cn("min-w-0", view === "list" && "sm:flex-1")}>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label(item.type)}
        </p>
        <h3 className="mt-1 text-sm font-semibold leading-snug">{item.name}</h3>
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

function useCollapsedEntities(): [Set<string>, (entity: string) => void] {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(COLLAPSED_KEY);
      if (!stored) return;
      const names = JSON.parse(stored) as unknown;
      if (Array.isArray(names)) {
        setCollapsed(new Set(names.filter((name): name is string => typeof name === "string")));
      }
    } catch {
      // ignore
    }
  }, []);

  function toggle(entity: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(entity)) next.delete(entity);
      else next.add(entity);
      try {
        window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      } catch {
        // ignore
      }
      return next;
    });
  }

  return [collapsed, toggle];
}

export function LiabilitiesBoard({
  liabilities,
  total,
}: {
  liabilities: LiabilityCard[];
  total: string;
}) {
  const [view, setView] = useStoredView("hundie:liabilities-view");
  const [collapsed, toggleCollapsed] = useCollapsedEntities();

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
        <div className="space-y-4">
          {groupByEntity(liabilities).map(([entity, items]) => {
            const subtotal = items.reduce((sum, item) => sum + item.balance, 0);
            const isCollapsed = collapsed.has(entity);
            return (
              <section key={entity} className="overflow-hidden rounded-xl border border-border bg-card">
                <button
                  type="button"
                  aria-expanded={!isCollapsed}
                  onClick={() => toggleCollapsed(entity)}
                  className="flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-accent/40"
                >
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                      isCollapsed && "-rotate-90",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-semibold">{entity}</span>
                    <span className="text-xs text-muted-foreground">
                      {items.length} {items.length === 1 ? "item" : "items"}
                    </span>
                  </span>
                  <span className="text-2xl font-semibold tabular-nums">{formatCurrency(subtotal)}</span>
                </button>
                {isCollapsed ? null : (
                  <div
                    className={cn(
                      "border-t border-border p-4",
                      view === "grid" ? "grid gap-3 sm:grid-cols-2 xl:grid-cols-3" : "space-y-2",
                    )}
                  >
                    {items.map((item) => (
                      <LiabilityItem key={item.id} item={item} view={view} />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
