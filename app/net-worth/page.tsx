import { BalanceTotals } from "@/components/balance/balance-totals";
import { NetWorthSheet } from "@/components/balance/net-worth-sheet";
import { loadBalanceSheet } from "@/lib/balance/load-sheet";

export default async function NetWorthPage() {
  const { assets, liabilities, totals } = await loadBalanceSheet();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Net worth</h1>
        <p className="text-sm text-muted-foreground">Each asset with the debt on it. Credit cards sit on their own.</p>
      </div>
      <BalanceTotals totals={totals} highlight="net" details={false} />
      <NetWorthSheet assets={assets} liabilities={liabilities} totals={totals} />
    </div>
  );
}
