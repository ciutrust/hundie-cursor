"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { AssetCard } from "./assets-board";
import type { BalanceTotalsData } from "./balance-totals";
import type { LiabilityCard } from "./liabilities-board";
import { cn, formatCurrency } from "@/lib/utils";

const COLLAPSED_KEY = "hundie:net-worth-collapsed";

function cents(value: number) {
  return Math.round(value * 100);
}

function Money({ amount, debt = false, bold = false }: { amount: number; debt?: boolean; bold?: boolean }) {
  const shown = debt ? -Math.abs(amount) : amount;
  const red = debt || shown < 0;
  return (
    <span
      className={cn(
        "tabular-nums",
        bold ? "font-bold" : "font-medium",
        red && "text-red-600 dark:text-red-400",
      )}
    >
      {formatCurrency(shown)}
    </span>
  );
}

function useCollapsed() {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(COLLAPSED_KEY);
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      if (Array.isArray(parsed)) {
        setCollapsed(new Set(parsed.filter((name): name is string => typeof name === "string")));
      }
    } catch {
      // ignore
    }
  }, []);

  function toggle(name: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      try {
        window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      } catch {
        // ignore
      }
      return next;
    });
  }

  return { collapsed, toggle };
}

export function NetWorthSheet({
  assets,
  liabilities,
  totals,
}: {
  assets: AssetCard[];
  liabilities: LiabilityCard[];
  totals: BalanceTotalsData;
}) {
  const { collapsed, toggle } = useCollapsed();
  const assetIds = new Set(assets.map((asset) => asset.id));
  const linked = new Map<string, LiabilityCard[]>();
  const unlinked: LiabilityCard[] = [];
  for (const item of liabilities) {
    if (item.assetId && assetIds.has(item.assetId)) {
      const list = linked.get(item.assetId) ?? [];
      list.push(item);
      linked.set(item.assetId, list);
    } else {
      unlinked.push(item);
    }
  }

  const entities = [...new Set([...assets.map((asset) => asset.entity), ...unlinked.map((item) => item.entity)])].sort(
    (a, b) => a.localeCompare(b),
  );

  const assetSum = assets.reduce((sum, asset) => sum + asset.value, 0);
  const liabilitySum = liabilities.reduce((sum, item) => sum + item.balance, 0);
  const matches = cents(assetSum) === cents(totals.assetTotal) && cents(liabilitySum) === cents(totals.liabilityTotal);

  return (
    <div className="space-y-4">
      {entities.map((entity) => {
        const entityAssets = assets
          .filter((asset) => asset.entity === entity)
          .sort((a, b) => a.name.localeCompare(b.name));
        const entityUnlinked = unlinked
          .filter((item) => item.entity === entity)
          .sort((a, b) => a.name.localeCompare(b.name));
        const entityAssetTotal = entityAssets.reduce((sum, asset) => sum + asset.value, 0);
        const linkedDebt = entityAssets.reduce(
          (sum, asset) => sum + (linked.get(asset.id) ?? []).reduce((inner, item) => inner + item.balance, 0),
          0,
        );
        const unlinkedDebt = entityUnlinked.reduce((sum, item) => sum + item.balance, 0);
        const entityLiabilityTotal = linkedDebt + unlinkedDebt;
        const entityNet = entityAssetTotal - entityLiabilityTotal;
        const isCollapsed = collapsed.has(entity);

        return (
          <section key={entity} className="overflow-hidden rounded-xl border border-border bg-card">
            <button
              type="button"
              onClick={() => toggle(entity)}
              aria-expanded={!isCollapsed}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent/40"
            >
              <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition", isCollapsed && "-rotate-90")} />
              <span className="min-w-0 flex-1 text-base font-semibold">{entity}</span>
              <span className="hidden min-w-28 shrink-0 text-right sm:block">
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Assets</span>
                <Money amount={entityAssetTotal} bold />
              </span>
              <span className="hidden min-w-28 shrink-0 text-right sm:block">
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Liabilities</span>
                <Money amount={entityLiabilityTotal} debt bold />
              </span>
              <span className="min-w-28 shrink-0 text-right">
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Net</span>
                <Money amount={entityNet} bold />
              </span>
            </button>
            {isCollapsed ? null : (
              <div className="space-y-3 border-t border-border bg-muted/30 p-3">
                {entityAssets.map((asset) => {
                  const debts = [...(linked.get(asset.id) ?? [])].sort((a, b) => a.name.localeCompare(b.name));
                  const debtTotal = debts.reduce((sum, item) => sum + item.balance, 0);
                  return (
                    <article key={asset.id} className="rounded-lg border border-border bg-background p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            {asset.type.replaceAll("_", " ")}
                          </p>
                          <p className="text-sm font-semibold">{asset.name}</p>
                        </div>
                        <Money amount={asset.value} bold />
                      </div>
                      {debts.length > 0 ? (
                        <div className="mt-3 space-y-2 border-l-2 border-red-300 pl-3 dark:border-red-900">
                          {debts.map((debt) => (
                            <div key={debt.id} className="flex items-baseline justify-between gap-3">
                              <div>
                                <p className="text-sm text-red-600 dark:text-red-400">{debt.name}</p>
                                {debt.entity !== asset.entity ? (
                                  <p className="text-xs text-muted-foreground">Debt is on {debt.entity}</p>
                                ) : null}
                              </div>
                              <Money amount={debt.balance} debt />
                            </div>
                          ))}
                          <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2">
                            <p className="text-sm font-semibold">Equity</p>
                            <Money amount={asset.value - debtTotal} bold />
                          </div>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
                {entityUnlinked.length > 0 ? (
                  <article className="rounded-lg border border-border bg-background p-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="text-lg font-bold">Other liabilities</h3>
                      <Money amount={unlinkedDebt} debt bold />
                    </div>
                    <div className="mt-3 space-y-2 border-l-2 border-red-300 pl-3 dark:border-red-900">
                      {entityUnlinked.map((item) => (
                        <div key={item.id} className="flex items-baseline justify-between gap-3">
                          <p className="text-sm text-red-600 dark:text-red-400">{item.name}</p>
                          <Money amount={item.balance} debt />
                        </div>
                      ))}
                    </div>
                  </article>
                ) : null}
              </div>
            )}
          </section>
        );
      })}
      <p className={matches ? "text-sm text-muted-foreground" : "text-sm text-amber-700 dark:text-amber-400"}>
        {matches
          ? `These rows add up to the totals above. Assets ${formatCurrency(assetSum)}. Liabilities ${formatCurrency(liabilitySum)}. Net ${formatCurrency(assetSum - liabilitySum)}.`
          : `The rows do not match the totals. Assets differ by ${formatCurrency(assetSum - totals.assetTotal)}. Liabilities differ by ${formatCurrency(liabilitySum - totals.liabilityTotal)}.`}
      </p>
    </div>
  );
}
