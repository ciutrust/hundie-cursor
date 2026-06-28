import type { AggregatorTransaction } from "@/lib/aggregator";

/**
 * Decides whether a (mapped) Plaid transaction is a ledger-eligible row, mirroring the rules every CSV
 * parser enforces so the two import paths cannot diverge. Dropped in both paths:
 *   - card payments (name `/payment|thank you|autopay|online pmt|mobile pmt/i`),
 *   - $0 auth-hold noise,
 *   - loan/card payments by Plaid category (LOAN_PAYMENTS).
 *
 * Income capture (Phase 3): checking/savings DEPOSITS (negative = money-in) are now KEPT so income can
 * be captured and classified (kind=income). They land uncategorized; the operator classifies them.
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

  // Guard: a credit-card transaction Plaid tags INCOME is almost always a mis-categorized, often
  // mis-signed, unsettled charge — cards don't receive income (seen with Citi Strata: a $200 charge
  // came through negative + tagged INCOME). Skip it; once settled, Plaid re-reports it correctly.
  const isCard = accountType === "credit_card" || accountType === "credit";
  if (isCard && t.rawCategory?.toUpperCase() === "INCOME") return false;

  // Keep everything else: card charges (positive), refunds (negative), and depository
  // deposits/income (negative inflows) — classified after import.
  return true;
}
