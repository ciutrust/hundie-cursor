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
      </div>
    </article>
  );
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
        <div className={view === "grid" ? "grid gap-3 sm:grid-cols-2 xl:grid-cols-3" : "space-y-2"}>
          {liabilities.map((item) => (
            <LiabilityItem key={item.id} item={item} view={view} />
          ))}
        </div>
      )}
    </div>
  );
}
