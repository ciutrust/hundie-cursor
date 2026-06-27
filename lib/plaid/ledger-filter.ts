import type { AggregatorTransaction } from "@/lib/aggregator";

/**
 * Decides whether a (mapped) Plaid transaction is a ledger-eligible expense/refund row, mirroring
 * the rules every CSV parser enforces so the two import paths cannot diverge. The CSV path drops:
 *   - card payments (name `/payment|thank you|autopay|online pmt|mobile pmt/i`),
 *   - $0 auth-hold noise,
 *   - for checking/savings, ALL money-in (deposits / income / transfers-in).
 *
 * Amounts here are in LEDGER sign (no flip): positive = charge/outflow, negative = refund/money-in.
 */
const PAYMENT_NAME_RE = /payment|thank you|autopay|online pmt|mobile pmt|auto[\s-]?pay|e-?pay/i;
// Plaid personal_finance_category.primary values that are transfers, not expenses.
const DROP_PFC = new Set(["LOAN_PAYMENTS"]);

export function shouldImportPlaidTxn(
  t: Pick<AggregatorTransaction, "amount" | "description" | "rawCategory" | "pending">,
  accountType: string,
): boolean {
  if (t.pending) return false; // posted-only
  if (t.amount === 0) return false; // $0 auth-hold noise
  if (t.rawCategory && DROP_PFC.has(t.rawCategory.toUpperCase())) return false; // CC/loan payments
  if (PAYMENT_NAME_RE.test(t.description)) return false; // payments / autopay / thank-you

  // Depository accounts: only outflows are expenses; deposits/income/transfers-in are out of scope.
  const isDepository = accountType === "checking" || accountType === "savings";
  if (isDepository && t.amount <= 0) return false;

  // Credit cards: keep charges (positive) and genuine refunds (negative, already not a payment).
  return true;
}
