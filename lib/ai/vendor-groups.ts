import { extractVendorSearchKey } from "@/lib/suggestions/category-suggestions";

export type BacklogTransaction = {
  id: string;
  transaction_date: string;
  amount: number;
  description: string;
  vendor: string | null;
  account_slug: string;
  account_display_name: string;
  current_entity_slug: string;
  default_entity_slug: string | null;
  classification_id: string;
  ai_suggestion?: {
    entity_slug: string;
    suggested_category_id: string | null;
    suggested_category_path: string | null;
    confidence: string;
    rationale: string;
  } | null;
};

export type VendorGroup = {
  vendorKey: string;
  label: string;
  transactions: BacklogTransaction[];
  total: number;
};

export function buildVendorGroups(transactions: BacklogTransaction[]): VendorGroup[] {
  const map = new Map<string, BacklogTransaction[]>();

  for (const tx of transactions) {
    const key = extractVendorSearchKey(tx.description, tx.vendor) || "(unknown)";
    const list = map.get(key) ?? [];
    list.push(tx);
    map.set(key, list);
  }

  return [...map.entries()]
    .map(([vendorKey, txs]) => ({
      vendorKey,
      label: vendorKey,
      transactions: txs.sort((a, b) => a.transaction_date.localeCompare(b.transaction_date)),
      total: txs.reduce((sum, tx) => sum + Math.abs(Number(tx.amount)), 0),
    }))
    .sort((a, b) => b.transactions.length - a.transactions.length || b.total - a.total);
}

export function groupLabelFromTransactions(transactions: BacklogTransaction[]): string {
  if (transactions.length === 0) return "";
  const first = transactions[0];
  return extractVendorSearchKey(first.description, first.vendor) || first.description.slice(0, 40);
}
