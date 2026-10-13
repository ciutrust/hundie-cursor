import { BalanceTotals } from "@/components/balance/balance-totals";
import { loadBalanceSheet } from "@/lib/balance/load-sheet";

export default async function NetWorthPage() {
  const { totals } = await loadBalanceSheet();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Net worth</h1>
        <p className="text-sm text-muted-foreground">Assets minus every liability, including credit cards.</p>
      </div>
      <BalanceTotals totals={totals} highlight="net" />
    </div>
  );
}
