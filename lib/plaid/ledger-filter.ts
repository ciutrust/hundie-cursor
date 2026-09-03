import type { AggregatorTransaction } from "@/lib/aggregator";

/**
 * Decides whether a (mapped) Plaid transaction is a ledger-eligible row, mirroring the rules every CSV
 * parser enforces so the two import paths cannot diverge. Dropped in both paths:
 *   - card payments (name `/payment|thank you|autopay|online pmt|mobile pmt/i`),
 *   - $0 auth-hold noise,
 *   - loan/card payments by Plaid category (LOAN_PAYMENTS) - on CARD accounts only.
 *
 * Income capture (Phase 3): checking/savings DEPOSITS (negative = money-in) are now KEPT so income can
 * be captured and classified (kind=income). They land uncategorized; the operator classifies them.
 *
 * Amounts here are in LEDGER sign (no flip): positive = charge/outflow, negative = refund/money-in.
 */
const PAYMENT_NAME_RE = /payment|thank you|autopay|online pmt|mobile pmt|auto[\s-]?pay|e-?pay/i;
// Plaid personal_finance_category.primary values that are transfers, not expenses.
const DROP_PFC = new Set(["LOAN_PAYMENTS"]);

export type PlaidDropReason = "pending" | "zero" | "pfc" | "payment" | "card_income";

/**
 * Pure classifier: returns the reason a row would be dropped, or null if it should be kept.
 * Single source of truth for `shouldImportPlaidTxn` and for drop-count summaries (C12) — keeping
 * this pure (no logging/side effects) so callers can tally reasons without re-implementing rules.
 */
export function classifyPlaidDrop(
  t: Pick<AggregatorTransaction, "amount" | "description" | "rawCategory" | "pending">,
  accountType: string,
): PlaidDropReason | null {
  if (t.pending) return "pending"; // posted-only
  if (t.amount === 0) return "zero"; // $0 auth-hold noise

  const isCard = accountType === "credit_card" || accountType === "credit";

  // LOAN_PAYMENTS is Plaid's coarse bucket (we only get `primary`, never `detailed`), and it covers
  // both a card's own payment credit AND a real loan draft out of checking. Drop it on CARD accounts
  // only: the card-side payment credit is the twin the ledger deliberately never imports. On a
  // depository account a LOAN_PAYMENTS row is money actually leaving - a mortgage, a business loan,
  // or a card payment that then categorizes as a transfer - and dropping it silently erased the
  // GBSL "CNB BANK TRANSFER ... LOAN PAYMENT" draft ($5,810.04/mo) from the books for months.
  if (isCard && t.rawCategory && DROP_PFC.has(t.rawCategory.toUpperCase())) return "pfc";

  // Card payments (paying off a credit card) are transfers, not expenses — drop by name. On
  // depository (checking/savings) accounts the SAME name pattern is legitimate income/expense
  // activity (e.g. "ZELLE PAYMENT FROM <tenant>" rent income, "AUTO PAY" mortgage debit) that the
  // app WANTS to keep for income capture — so this drop must never fire outside card accounts.
  if (isCard && PAYMENT_NAME_RE.test(t.description)) return "payment";

  // Guard: a credit-card transaction Plaid tags INCOME is almost always a mis-categorized, often
  // mis-signed, unsettled charge — cards don't receive income (seen with Citi Strata: a $200 charge
  // came through negative + tagged INCOME). Skip it; once settled, Plaid re-reports it correctly.
  if (isCard && t.rawCategory?.toUpperCase() === "INCOME") return "card_income";

  // Keep everything else: card charges (positive), refunds (negative), and depository
  // deposits/income (negative inflows) — classified after import.
  return null;
}

export function shouldImportPlaidTxn(
  t: Pick<AggregatorTransaction, "amount" | "description" | "rawCategory" | "pending">,
  accountType: string,
): boolean {
  return classifyPlaidDrop(t, accountType) === null;
}

export type PlaidDropSummary = {
  kept: number;
  dropped: number;
  reasons: Record<PlaidDropReason, number>;
  samples: Partial<Record<PlaidDropReason, string[]>>;
};

const MAX_SAMPLES_PER_REASON = 3;

/**
 * C12: dropped rows previously left "zero log/quarantine" trace. Pure tally of why rows were
 * dropped (plus a few sample descriptions per reason) so a caller can log a one-line, per-import
 * visibility summary without making the predicate itself impure.
 */
export function summarizePlaidDrops(
  txns: ReadonlyArray<Pick<AggregatorTransaction, "amount" | "description" | "rawCategory" | "pending">>,
  accountType: string,
): PlaidDropSummary {
  const reasons: Record<PlaidDropReason, number> = {
    pending: 0,
    zero: 0,
    pfc: 0,
    payment: 0,
    card_income: 0,
  };
  const samples: Partial<Record<PlaidDropReason, string[]>> = {};
  let kept = 0;
  let dropped = 0;

  for (const t of txns) {
    const reason = classifyPlaidDrop(t, accountType);
    if (reason === null) {
      kept += 1;
      continue;
    }
    dropped += 1;
    reasons[reason] += 1;
    const list = samples[reason] ?? [];
    if (list.length < MAX_SAMPLES_PER_REASON) list.push(t.description);
    samples[reason] = list;
  }

  return { kept, dropped, reasons, samples };
}
