import { summarizeTotals, type BalanceTotalsData } from "@/components/balance/balance-totals";
import type { AssetCard } from "@/components/balance/assets-board";
import type { LiabilityCard } from "@/components/balance/liabilities-board";
import { freshness } from "@/lib/balance/freshness";
import { createClient } from "@/lib/supabase/server";

function entityLabel(entity: unknown): string {
  if (!entity) return "—";
  if (Array.isArray(entity)) {
    const first = entity[0] as { name?: string } | undefined;
    return first?.name || "—";
  }
  if (typeof entity === "object" && "name" in entity) {
    return (entity as { name?: string }).name || "—";
  }
  return "—";
}

export async function loadBalanceSheet(): Promise<{
  assets: AssetCard[];
  liabilities: LiabilityCard[];
  totals: BalanceTotalsData;
}> {
  const supabase = await createClient();
  const [assetsResult, liabilitiesResult] = await Promise.all([
    supabase
      .from("assets")
      .select("id, type, name, current_value, notes, updated_at, entity:entities(name, slug)")
      .order("type")
      .order("name"),
    supabase
      .from("liabilities")
      .select(
        "id, type, name, current_balance, interest_rate, notes, updated_at, last_synced_at, entity:entities(name, slug)",
      )
      .order("type")
      .order("name"),
  ]);
  if (assetsResult.error) throw new Error(assetsResult.error.message);
  if (liabilitiesResult.error) throw new Error(liabilitiesResult.error.message);

  const assets: AssetCard[] = (assetsResult.data ?? []).map((asset) => {
    const fresh = freshness(asset.updated_at);
    return {
      id: asset.id,
      name: asset.name,
      type: asset.type,
      entity: entityLabel(asset.entity),
      value: Number(asset.current_value || 0),
      notes: asset.notes,
      updatedLabel: fresh.label,
      stale: fresh.stale,
    };
  });

  const liabilities: LiabilityCard[] = (liabilitiesResult.data ?? []).map((item) => {
    const fresh = freshness(item.last_synced_at ?? item.updated_at);
    return {
      id: item.id,
      name: item.name,
      type: item.type,
      entity: entityLabel(item.entity),
      balance: Number(item.current_balance || 0),
      apr: item.interest_rate == null ? null : Number(item.interest_rate),
      notes: item.notes,
      updatedLabel: fresh.label,
      stale: fresh.stale,
    };
  });

  return {
    assets,
    liabilities,
    totals: summarizeTotals(
      assets,
      liabilities.map((item) => ({
        name: item.name,
        entity: item.entity,
        balance: item.balance,
        type: item.type,
        notes: item.notes,
      })),
    ),
  };
}
