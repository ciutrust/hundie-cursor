import { LiabilitiesBoard, type LiabilityCard } from "@/components/balance/liabilities-board";
import { freshness } from "@/lib/balance/freshness";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/utils";

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

export default async function LiabilitiesPage() {
  const supabase = await createClient();
  const { data: liabilities } = await supabase
    .from("liabilities")
    .select("id, type, name, current_balance, interest_rate, updated_at, last_synced_at, entity:entities(name, slug)")
    .order("type")
    .order("name");

  const cards: LiabilityCard[] = (liabilities ?? []).map((item) => {
    const fresh = freshness(item.last_synced_at ?? item.updated_at);
    return {
      id: item.id,
      name: item.name,
      type: item.type,
      entity: entityLabel(item.entity),
      balance: Number(item.current_balance || 0),
      apr: item.interest_rate == null ? null : Number(item.interest_rate),
      updatedLabel: fresh.label,
      stale: fresh.stale,
    };
  });
  const total = cards.reduce((sum, item) => sum + item.balance, 0);

  return <LiabilitiesBoard liabilities={cards} total={formatCurrency(total)} />;
}
