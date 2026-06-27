import { categoryKind, NON_EXPENSE_CATEGORY_PATHS } from "./category-kind";

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
