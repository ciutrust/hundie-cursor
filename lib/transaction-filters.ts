import { isCpaReviewCategory } from "@/lib/category-review";
import { extractVendorSearchKey } from "@/lib/suggestions/category-suggestions";
import type { TransactionWithDetails } from "@/lib/types/database";

export const UNCLASSIFIED_CATEGORY_ID = "__unclassified__";

export type AmountOperator = "any" | "eq" | "gt" | "lt";

export type FilterOption = {
  id: string;
  label: string;
};

export type CategoryFilterOption = FilterOption;
export type AccountFilterOption = FilterOption;

export type TransactionFilterState = {
  searchText: string;
  amountOperator: AmountOperator;
  amountValue: string;
  categoryIds: string[];
  accountIds: string[];
  reviewBacklogOnly: boolean;
  /** When set, keep only transactions whose vendor key matches (Find similar). */
  similarVendorKey: string | null;
};

export const EMPTY_TRANSACTION_FILTERS: TransactionFilterState = {
  searchText: "",
  amountOperator: "any",
  amountValue: "",
  categoryIds: [],
  accountIds: [],
  reviewBacklogOnly: false,
  similarVendorKey: null,
};

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  credit_card: "Credit card",
  checking: "Checking",
  savings: "Savings",
};

function parseAmountInput(value: string): number | null {
  const cleaned = value.replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function transactionSearchHaystack(tx: TransactionWithDetails): string {
  const accountType = tx.account.account_type
    ? ACCOUNT_TYPE_LABELS[tx.account.account_type] ?? tx.account.account_type
    : null;

  return [
    tx.description,
    tx.vendor,
    tx.account.display_name,
    accountType,
    tx.classification.category?.full_path,
    String(tx.amount),
    Math.abs(Number(tx.amount)).toFixed(2),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function matchesAmountFilter(amount: number, operator: AmountOperator, target: number): boolean {
  const value = Math.abs(amount);

  switch (operator) {
    case "eq":
      return Math.abs(value - Math.abs(target)) < 0.005;
    case "gt":
      return value > Math.abs(target);
    case "lt":
      return value < Math.abs(target);
    default:
      return true;
  }
}

function transactionCategoryFilterId(tx: TransactionWithDetails): string {
  return tx.classification.category_id ?? UNCLASSIFIED_CATEGORY_ID;
}

export function isReviewBacklogTransaction(tx: TransactionWithDetails): boolean {
  // A split transaction is resolved (its legs are all categorized) — never backlog.
  if (tx.splits && tx.splits.length >= 2) return false;
  const fullPath = tx.classification.category?.full_path;
  return !fullPath || isCpaReviewCategory(fullPath);
}

export function getCategoryFilterOptions(
  transactions: TransactionWithDetails[],
  allCategories: Array<{ id: string; full_path: string }> = [],
): CategoryFilterOption[] {
  const options = new Map<string, CategoryFilterOption>();

  for (const category of allCategories) {
    options.set(category.id, { id: category.id, label: category.full_path });
  }

  for (const tx of transactions) {
    const category = tx.classification.category;
    if (category) {
      options.set(category.id, { id: category.id, label: category.full_path });
    } else {
      options.set(UNCLASSIFIED_CATEGORY_ID, {
        id: UNCLASSIFIED_CATEGORY_ID,
        label: "Unclassified",
      });
    }
  }

  return Array.from(options.values()).sort((a, b) => {
    if (a.id === UNCLASSIFIED_CATEGORY_ID) return 1;
    if (b.id === UNCLASSIFIED_CATEGORY_ID) return -1;
    return a.label.localeCompare(b.label);
  });
}

export function getAccountFilterOptions(transactions: TransactionWithDetails[]): AccountFilterOption[] {
  const options = new Map<string, AccountFilterOption>();

  for (const tx of transactions) {
    const typeLabel = tx.account.account_type
      ? ACCOUNT_TYPE_LABELS[tx.account.account_type] ?? tx.account.account_type
      : null;

    options.set(tx.account.id, {
      id: tx.account.id,
      label: typeLabel ? `${tx.account.display_name} (${typeLabel})` : tx.account.display_name,
    });
  }

  return Array.from(options.values()).sort((a, b) => a.label.localeCompare(b.label));
}

/** Vendor key used to group "similar" transactions (same merchant), shared with suggestions. */
export function transactionVendorKey(
  tx: Pick<TransactionWithDetails, "description" | "vendor">,
): string {
  return extractVendorSearchKey(tx.description, tx.vendor);
}

export function filterTransactions(
  transactions: TransactionWithDetails[],
  filters: TransactionFilterState,
): TransactionWithDetails[] {
  const search = filters.searchText.trim().toLowerCase();
  const amountTarget = parseAmountInput(filters.amountValue);
  const hasAmountFilter = filters.amountOperator !== "any" && amountTarget !== null;
  const hasCategoryFilter = filters.categoryIds.length > 0;
  const hasAccountFilter = filters.accountIds.length > 0;
  const categorySet = new Set(filters.categoryIds);
  const accountSet = new Set(filters.accountIds);

  return transactions.filter((tx) => {
    if (filters.reviewBacklogOnly && !isReviewBacklogTransaction(tx)) {
      return false;
    }

    if (search && !transactionSearchHaystack(tx).includes(search)) {
      return false;
    }

    if (hasAmountFilter && amountTarget !== null) {
      if (!matchesAmountFilter(Number(tx.amount), filters.amountOperator, amountTarget)) {
        return false;
      }
    }

    if (hasCategoryFilter && !categorySet.has(transactionCategoryFilterId(tx))) {
      return false;
    }

    if (hasAccountFilter && !accountSet.has(tx.account.id)) {
      return false;
    }

    if (filters.similarVendorKey && transactionVendorKey(tx) !== filters.similarVendorKey) {
      return false;
    }

    return true;
  });
}

export function hasActiveTransactionFilters(filters: TransactionFilterState): boolean {
  return (
    filters.searchText.trim().length > 0 ||
    (filters.amountOperator !== "any" && filters.amountValue.trim().length > 0) ||
    filters.categoryIds.length > 0 ||
    filters.accountIds.length > 0 ||
    filters.reviewBacklogOnly ||
    (filters.similarVendorKey != null && filters.similarVendorKey.length > 0)
  );
}

export function selectedFilterLabels(options: FilterOption[], selectedIds: string[]): string[] {
  return options.filter((option) => selectedIds.includes(option.id)).map((option) => option.label);
}
