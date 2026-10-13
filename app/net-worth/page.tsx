import { createClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/utils";

export default async function NetWorthPage() {
  const supabase = await createClient();
  const [{ data: assets }, { data: liabilities }] = await Promise.all([
    supabase.from("assets").select("current_value, entity:entities(name)"),
    supabase.from("liabilities").select("current_balance, entity:entities(name)"),
  ]);

  const assetTotal = (assets ?? []).reduce((sum, a) => sum + Number(a.current_value || 0), 0);
  const liabilityTotal = (liabilities ?? []).reduce(
    (sum, l) => sum + Number(l.current_balance || 0),
    0,
  );
  const net = assetTotal - liabilityTotal;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Net worth</h1>
        <p className="text-sm text-muted-foreground">Assets minus liabilities</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Assets</p>
          <p className="text-xl font-semibold tabular-nums">{formatCurrency(assetTotal)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Liabilities</p>
          <p className="text-xl font-semibold tabular-nums">{formatCurrency(liabilityTotal)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Net</p>
          <p className="text-xl font-semibold tabular-nums">{formatCurrency(net)}</p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Winding Ridge is included. Values are estimates until you update them.
      </p>
    </div>
  );
}
