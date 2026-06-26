import type { BacklogTransaction } from "@/lib/ai/vendor-groups";
import { buildVendorGroups } from "@/lib/ai/vendor-groups";

export type VendorGroupPackage = {
  vendor_key: string;
  transaction_ids: string[];
  count: number;
  sample_description: string;
  amount_min: number;
  amount_max: number;
  amount_typical: number;
  account_slug: string;
  date_first: string;
  date_last: string;
  current_entity: string;
};

export function buildVendorGroupPackages(transactions: BacklogTransaction[]): VendorGroupPackage[] {
  return buildVendorGroups(transactions).map((group) => {
    const amounts = group.transactions.map((tx) => Math.abs(Number(tx.amount)));
    const sortedDates = group.transactions.map((tx) => tx.transaction_date).sort();
    const amountCounts = new Map<number, number>();
    for (const amount of amounts) {
      amountCounts.set(amount, (amountCounts.get(amount) ?? 0) + 1);
    }
    let typical = amounts[0] ?? 0;
    let typicalCount = 0;
    for (const [amount, count] of amountCounts.entries()) {
      if (count > typicalCount) {
        typical = amount;
        typicalCount = count;
      }
    }

    return {
      vendor_key: group.vendorKey,
      transaction_ids: group.transactions.map((tx) => tx.id),
      count: group.transactions.length,
      sample_description: group.transactions[0]?.description ?? group.label,
      amount_min: Math.min(...amounts),
      amount_max: Math.max(...amounts),
      amount_typical: typical,
      account_slug: group.transactions[0]?.account_slug ?? "",
      date_first: sortedDates[0] ?? "",
      date_last: sortedDates[sortedDates.length - 1] ?? "",
      current_entity: group.transactions[0]?.current_entity_slug ?? "personal",
    };
  });
}

export function packagesForTransactionIds(
  transactions: BacklogTransaction[],
  transactionIds: string[],
): VendorGroupPackage[] {
  const idSet = new Set(transactionIds);
  const selected = transactions.filter((tx) => idSet.has(tx.id));
  return buildVendorGroupPackages(selected);
}
