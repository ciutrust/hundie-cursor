/**
 * Integer-cent money helpers. Split validation compares leg amounts to the parent total EXACTLY, so
 * we parse to integer cents (533.44 → 53344) and compare/sum in cents — never floats — to avoid
 * 0.1 + 0.2 drift making a correct split fail the sum-to-parent check.
 */

/** Parse a user-typed amount ("$1,234.56", "533.44", "-40") to integer cents, or null if invalid. */
export function parseAmountToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === "." || cleaned === "-.") return null;
  if (!/^-?\d*\.?\d*$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** Integer cents → a decimal number (for the RPC's numeric leg amounts). */
export function centsToNumber(cents: number): number {
  return cents / 100;
}

/** A decimal amount (transactions.amount) → integer cents. */
export function amountToCents(amount: number): number {
  return Math.round(amount * 100);
}

/** Integer cents → a fixed "1234.56" string (no currency symbol). */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}
