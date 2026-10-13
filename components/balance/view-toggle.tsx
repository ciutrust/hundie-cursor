"use client";

import { useEffect, useState } from "react";
import { LayoutGrid, List } from "lucide-react";
import { cn } from "@/lib/utils";

export type ItemView = "grid" | "list";

export function useStoredView(storageKey: string): [ItemView, (view: ItemView) => void] {
  const [view, setView] = useState<ItemView>("grid");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored === "list" || stored === "grid") setView(stored);
    } catch {
      // private mode
    }
  }, [storageKey]);

  function update(next: ItemView) {
    setView(next);
    try {
      window.localStorage.setItem(storageKey, next);
    } catch {
      // ignore
    }
  }

  return [view, update];
}

export function ViewToggle({
  view,
  onChange,
}: {
  view: ItemView;
  onChange: (view: ItemView) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-card p-0.5" role="group" aria-label="Layout">
      {(
        [
          ["grid", LayoutGrid, "Grid"],
          ["list", List, "List"],
        ] as const
      ).map(([value, Icon, label]) => (
        <button
          key={value}
          type="button"
          aria-pressed={view === value}
          onClick={() => onChange(value)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium",
            view === value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}
