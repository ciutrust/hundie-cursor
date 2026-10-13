"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";

const ORDER_KEY = "hundie:entity-order";

export type EntityGroup = {
  name: string;
  total: number;
  count: number;
  body: React.ReactNode;
};

function useEntityOrder(names: string[]) {
  const key = names.join("\0");
  const [order, setOrder] = useState<string[]>(() => [...names].sort((a, b) => a.localeCompare(b)));

  useEffect(() => {
    const known = names;
    let stored: string[] = [];
    try {
      const raw = window.localStorage.getItem(ORDER_KEY);
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      if (Array.isArray(parsed)) stored = parsed.filter((name): name is string => typeof name === "string");
    } catch {
      stored = [];
    }
    const next = stored.filter((name) => known.includes(name));
    for (const name of [...known].sort((a, b) => a.localeCompare(b))) {
      if (!next.includes(name)) next.push(name);
    }
    setOrder(next);
    // names is derived from the joined key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  function move(name: string, direction: -1 | 1) {
    setOrder((current) => {
      const index = current.indexOf(name);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      try {
        window.localStorage.setItem(ORDER_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }

  return { order, move };
}

function useCollapsed(storageKey: string) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      if (Array.isArray(parsed)) {
        setCollapsed(new Set(parsed.filter((name): name is string => typeof name === "string")));
      }
    } catch {
      // ignore
    }
  }, [storageKey]);

  function toggle(name: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify([...next]));
      } catch {
        // ignore
      }
      return next;
    });
  }

  return { collapsed, toggle };
}

export function EntityStack({
  groups,
  view,
  collapseKey,
}: {
  groups: EntityGroup[];
  view: "grid" | "list";
  collapseKey: string;
}) {
  const { order, move } = useEntityOrder(groups.map((group) => group.name));
  const { collapsed, toggle } = useCollapsed(collapseKey);
  const byName = new Map(groups.map((group) => [group.name, group]));
  const ordered = order.map((name) => byName.get(name)).filter((group): group is EntityGroup => Boolean(group));

  return (
    <div className="space-y-4">
      {ordered.map((group, index) => {
        const isCollapsed = collapsed.has(group.name);
        return (
          <section key={group.name} className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex items-center gap-2 px-4 py-4">
              <button
                type="button"
                aria-expanded={!isCollapsed}
                aria-label={isCollapsed ? `Expand ${group.name}` : `Collapse ${group.name}`}
                onClick={() => toggle(group.name)}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <ChevronDown className={cn("h-4 w-4 transition-transform", isCollapsed && "-rotate-90")} />
              </button>
              <button
                type="button"
                onClick={() => toggle(group.name)}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block truncate text-base font-semibold">{group.name}</span>
                <span className="text-xs text-muted-foreground">
                  {group.count} {group.count === 1 ? "item" : "items"}
                </span>
              </button>
              <div className="flex shrink-0 flex-col">
                <button
                  type="button"
                  aria-label={`Move ${group.name} up`}
                  disabled={index === 0}
                  onClick={() => move(group.name, -1)}
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${group.name} down`}
                  disabled={index === ordered.length - 1}
                  onClick={() => move(group.name, 1)}
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="text-2xl font-semibold tabular-nums">{formatCurrency(group.total)}</p>
            </div>
            {isCollapsed ? null : (
              <div
                className={cn(
                  "border-t border-border p-4",
                  view === "grid" ? "grid gap-3 sm:grid-cols-2 xl:grid-cols-3" : "space-y-2",
                )}
              >
                {group.body}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
