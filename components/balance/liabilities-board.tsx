"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateLiabilityBalance } from "@/lib/actions/update-liability-balance";
import { cn, formatCurrency } from "@/lib/utils";
import { BalanceTotals, type BalanceTotalsData } from "./balance-totals";
import { EntityStack } from "./entity-stack";
import { useStoredView, ViewToggle } from "./view-toggle";

export type LiabilityCard = {
  id: string;
  name: string;
  type: string;
  entity: string;
  balance: number;
  apr: number | null;
  notes: string | null;
  manual: boolean;
  updatedLabel: string;
  stale: boolean;
};

function label(type: string) {
  return type.replaceAll("_", " ");
}

function BalanceField({ id, balance }: { id: string; balance: number }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(balance));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const parsed = Number(draft.replace(/[$,\s]/g, ""));
    if (!Number.isFinite(parsed) || parsed < 0) {
      setError("Enter a dollar amount");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await updateLiabilityBalance({ id, balance: parsed });
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setEditing(false);
    router.refresh();
  }

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-2">
        <p className="text-lg font-semibold tabular-nums">{formatCurrency(balance)}</p>
        <button
          type="button"
          onClick={() => {
            setDraft(String(balance));
            setError(null);
            setEditing(true);
          }}
          className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          Edit
        </button>
      </div>
    );
  }

  return (
    <form
      className="space-y-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <input
        autoFocus
        inputMode="decimal"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        aria-label="Balance"
        className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm tabular-nums"
      />
      <div className="flex gap-1.5">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setEditing(false)}
          className="rounded-md border border-border px-2 py-1 text-xs"
        >
          Cancel
        </button>
      </div>
      {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
    </form>
  );
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
        {item.manual ? (
          <BalanceField id={item.id} balance={item.balance} />
        ) : (
          <p className="text-lg font-semibold tabular-nums">{formatCurrency(item.balance)}</p>
        )}
        <p className="text-xs text-muted-foreground">{item.apr != null ? `${item.apr}% APR` : "APR not set"}</p>
        <p className={cn("text-xs", item.stale ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
          {item.updatedLabel}
        </p>
      </div>
    </article>
  );
}

function groupByEntity(items: LiabilityCard[]) {
  const groups = new Map<string, LiabilityCard[]>();
  for (const item of items) {
    const list = groups.get(item.entity) ?? [];
    list.push(item);
    groups.set(item.entity, list);
  }
  return [...groups.entries()];
}

export function LiabilitiesBoard({
  liabilities,
  totals,
}: {
  liabilities: LiabilityCard[];
  totals: BalanceTotalsData;
}) {
  const [view, setView] = useStoredView("hundie:liabilities-view");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Liabilities</h1>
          <p className="text-sm text-muted-foreground">Grouped by entity. Arrows change the order on Assets too.</p>
        </div>
        <ViewToggle view={view} onChange={setView} />
      </div>
      <BalanceTotals totals={totals} highlight="liabilities" />
      {liabilities.length === 0 ? (
        <p className="text-sm text-muted-foreground">No liabilities yet.</p>
      ) : (
        <EntityStack
          collapseKey="hundie:liabilities-collapsed"
          view={view}
          groups={groupByEntity(liabilities).map(([name, items]) => ({
            name,
            total: items.reduce((sum, item) => sum + item.balance, 0),
            count: items.length,
            body: items.map((item) => <LiabilityItem key={item.id} item={item} view={view} />),
          }))}
        />
      )}
    </div>
  );
}
