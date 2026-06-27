import type { Transaction as PlaidTransaction } from "plaid";
import type { AggregatorAccount, AggregatorTransaction } from "./types";

/** Plaid account.type → our coarse type. */
export function mapAccountType(t: string): AggregatorAccount["type"] {
  if (t === "credit") return "credit";
  if (t === "depository") return "depository";
  return "other";
}

/**
 * Map a Plaid transaction to THIS repo's ledger shape.
 *
 * SIGN: Plaid uses positive = money OUT of the account (a charge), negative = money IN
 * (deposit/refund). This ledger uses the SAME convention (positive = charge, negative = refund),
 * so we do NOT flip the sign — unlike the multi-tenant build, which uses negative = expense.
 * amount stays in dollars, rounded to 2 decimals (the column is numeric(12,2)).
 *
 * DATE: transactionDate prefers Plaid's authorized_date (the date you made the charge, matching the
 * statement "transaction date"), falling back to the posted `date`; postedDate is the posted `date`.
 */
export function mapTransaction(t: PlaidTransaction): AggregatorTransaction {
  return {
    externalId: t.transaction_id,
    accountExternalId: t.account_id,
    transactionDate: t.authorized_date ?? t.date,
    postedDate: t.date ?? null,
    amount: Math.round(t.amount * 100) / 100,
    description: t.name,
    vendor: t.merchant_name ?? null,
    rawCategory: t.personal_finance_category?.primary ?? t.category?.[0] ?? null,
    pending: Boolean(t.pending),
  };
}
