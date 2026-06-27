/** Categories that move money or stage reclassification — not operating expenses. */
export const NON_EXPENSE_CATEGORY_PATHS = new Set([
  "Credit card payment",
  "Transfer / Zelle (personal)",
  "Refund / credit",
  "Intercompany — pending",
  "Security deposit movement",
  "→ GBSL business expense",
  "→ Keller business expense",
  "→ Austin ACAA (136 Anita)",
  "→ Pflugerville rental",
  "→ Personal (mis-posted)",
  "Mixed / pending allocation",
]);

export function isNonExpenseCategory(fullPath: string | null | undefined) {
  return fullPath != null && NON_EXPENSE_CATEGORY_PATHS.has(fullPath);
}

export function countsAsExpense(fullPath: string | null | undefined) {
  return !isNonExpenseCategory(fullPath);
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
