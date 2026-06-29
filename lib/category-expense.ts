import { categoryKind, NON_EXPENSE_CATEGORY_PATHS } from "./category-kind";
import { needsCategoryReview } from "./category-review";

/** Re-exported for backward compatibility; the source of truth is lib/category-kind.ts. */
export { NON_EXPENSE_CATEGORY_PATHS };

export function isNonExpenseCategory(fullPath: string | null | undefined) {
  return fullPath != null && categoryKind(fullPath) !== "expense";
}

export function countsAsExpense(fullPath: string | null | undefined) {
  return categoryKind(fullPath) === "expense";
}

export function isExpenseAmount(amount: number | string) {
  return Number(amount) > 0;
}

export function isOperatingExpense(
  amount: number | string,
  categoryFullPath: string | null | undefined,
) {
  return isExpenseAmount(amount) && countsAsExpense(categoryFullPath);
}

/**
 * Books an operating-expense LINE by category kind ALONE, independent of amount sign — so a refund
 * (negative amount) in an expense category is still a booked-expense line and nets its charge (BUG-04).
 * Excludes review categories (uncategorized + "Ask My Accountant"), so this is the single predicate
 * behind BOTH /review and /reports expense rollups (QA-01).
 */
export function isBookedOperatingExpense(categoryFullPath: string | null | undefined): boolean {
  return countsAsExpense(categoryFullPath) && !needsCategoryReview(categoryFullPath);
}

/** Signed sum of booked operating-expense lines (refunds net). Single source of truth for expense totals. */
export function sumBookedOperatingExpense(
  rows: Array<{ amount: number | string; categoryFullPath: string | null | undefined }>,
): number {
  return rows
    .filter((r) => isBookedOperatingExpense(r.categoryFullPath))
    .reduce((sum, r) => sum + Number(r.amount), 0);
}
