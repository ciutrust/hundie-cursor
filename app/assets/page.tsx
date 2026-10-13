import { AssetsBoard, type AssetCard } from "@/components/balance/assets-board";
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

export default async function AssetsPage() {
  const supabase = await createClient();
  const { data: assets } = await supabase
    .from("assets")
    .select("id, type, name, current_value, notes, entity:entities(name, slug)")
    .order("type")
    .order("name");

  const cards: AssetCard[] = (assets ?? []).map((asset) => ({
    id: asset.id,
    name: asset.name,
    type: asset.type,
    entity: entityLabel(asset.entity),
    value: Number(asset.current_value || 0),
    notes: asset.notes,
  }));
  const total = cards.reduce((sum, asset) => sum + asset.value, 0);

  return <AssetsBoard assets={cards} total={formatCurrency(total)} />;
}
