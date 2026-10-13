import type { AssetCard } from "./assets-board";
import type { BalanceTotalsData } from "./balance-totals";
import type { LiabilityCard } from "./liabilities-board";
import { formatCurrency } from "@/lib/utils";

function cents(value: number) {
  return Math.round(value * 100);
}

function Money({ amount, muted = false }: { amount: number; muted?: boolean }) {
  return (
    <span className={muted ? "tabular-nums text-muted-foreground" : "tabular-nums font-medium"}>
      {formatCurrency(amount)}
    </span>
  );
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
        const entityLiabilityTotal =
          entityAssets.reduce(
            (sum, asset) => sum + (linked.get(asset.id) ?? []).reduce((inner, item) => inner + item.balance, 0),
            0,
          ) + entityUnlinked.reduce((sum, item) => sum + item.balance, 0);

        return (
          <section key={entity} className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-3">
              <h2 className="text-base font-semibold">{entity}</h2>
              <p className="text-right">
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Net</span>
                <span className="text-lg font-semibold tabular-nums">
                  {formatCurrency(entityAssetTotal - entityLiabilityTotal)}
                </span>
              </p>
            </div>
            <div className="divide-y divide-border">
              {entityAssets.map((asset) => {
                const debts = [...(linked.get(asset.id) ?? [])].sort((a, b) => a.name.localeCompare(b.name));
                const debtTotal = debts.reduce((sum, item) => sum + item.balance, 0);
                return (
                  <div key={asset.id} className="px-4 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {asset.type.replaceAll("_", " ")}
                        </p>
                        <p className="text-sm font-semibold">{asset.name}</p>
                      </div>
                      <Money amount={asset.value} />
                    </div>
                    {debts.map((debt) => (
                      <div key={debt.id} className="mt-2 flex items-baseline justify-between gap-3 pl-4">
                        <div>
                          <p className="text-sm">{debt.name}</p>
                          {debt.entity !== asset.entity ? (
                            <p className="text-xs text-muted-foreground">Debt is on {debt.entity}</p>
                          ) : null}
                        </div>
                        <Money amount={debt.balance} muted />
                      </div>
                    ))}
                    {debts.length > 0 ? (
                      <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-dashed border-border pt-2 pl-4">
                        <p className="text-xs text-muted-foreground">Equity in this asset</p>
                        <Money amount={asset.value - debtTotal} />
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {entityUnlinked.length > 0 ? (
                <div className="px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Liabilities only
                  </p>
                  {entityUnlinked.map((item) => (
                    <div key={item.id} className="mt-2 flex items-baseline justify-between gap-3">
                      <p className="text-sm">{item.name}</p>
                      <Money amount={item.balance} muted />
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
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
