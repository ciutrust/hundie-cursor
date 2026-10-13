import { createClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/utils";

export default async function LiabilitiesPage() {
  const supabase = await createClient();
  const { data: liabilities } = await supabase
    .from("liabilities")
    .select("id, type, name, current_balance, interest_rate, entity:entities(name, slug)")
    .order("type").order("name");

  const total = (liabilities ?? []).reduce((sum, l) => sum + Number(l.current_balance || 0), 0);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Liabilities</h1>
        <p className="text-sm text-muted-foreground">Total owed: {formatCurrency(total)}</p>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Entity</th>
              <th className="px-4 py-3 font-medium text-right">Balance</th>
              <th className="px-4 py-3 font-medium text-right">APR</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(liabilities ?? []).map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-3 font-medium">{l.name}</td>
                <td className="px-4 py-3 capitalize">{l.type.replace("_"
, " ")}</td>
                <td className="px-4 py-3">{(l.entity as any)?.name || "—"}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(Number(l.current_balance))}</td>
                <td className="px-4 py-3 text-right">{l.interest_rate ? `${l.interest_rate}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">Estimates and pending Plaid Liabilities. Update balances as needed.</p>
    </div>
  );
}
