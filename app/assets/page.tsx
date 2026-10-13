import { AssetsBoard } from "@/components/balance/assets-board";
import { loadBalanceSheet } from "@/lib/balance/load-sheet";

export default async function AssetsPage() {
  const { assets, totals } = await loadBalanceSheet();
  return <AssetsBoard assets={assets} totals={totals} />;
}
