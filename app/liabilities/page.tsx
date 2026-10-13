import { LiabilitiesBoard } from "@/components/balance/liabilities-board";
import { loadBalanceSheet } from "@/lib/balance/load-sheet";

export default async function LiabilitiesPage() {
  const { liabilities, totals } = await loadBalanceSheet();
  return <LiabilitiesBoard liabilities={liabilities} totals={totals} />;
}
