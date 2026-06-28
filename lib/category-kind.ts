/**
 * Every category has a "kind" that determines how it rolls up. Expense is king — income, transfer,
 * funding, and capital are additive lenses. A non-null category not explicitly listed below is an
 * operating expense; a null/blank category is "unclassified" (NOT expense — see below).
 *
 * Phase 1 (foundation): this only relabels the existing non-expense categories into transfer/funding, so
 * expense totals stay byte-for-byte unchanged. Income and capital categories are populated in Phase 2.
 *
 * See docs/INCOME_CAPTURE_PLAN.md.
 */
export type CategoryKind =
  | "expense"
  | "income"
  | "transfer"
  | "funding"
  | "capital"
  | "unclassified";

/** Money movement that is neither spend nor income — card payments, transfers, refunds, redirects. */
const TRANSFER_PATHS = new Set<string>([
  "Credit card payment",
  "Transfer / Zelle (personal)",
  "Refund / credit",
  "Security deposit movement",
  "→ GBSL business expense",
  "→ Keller business expense",
  "→ Austin ACAA (136 Anita)",
  "→ Pflugerville rental",
  "→ Personal (mis-posted)",
  "Mixed / pending allocation",
  "Sales Tax Payable",
  "Credit card rewards / cash back",
]);

/** Equity / capital financing between Alex's own entities — kept off the P&L. */
const FUNDING_PATHS = new Set<string>([
  "Intercompany — pending",
  "Owner Contribution",
  "Owner Distribution",
  "Owners Equity",
  "Owners Equity:Owner Distribution",
]);

/** Fixed-asset flows, both directions (leasehold improvements, TI allowance, property purchase). */
const CAPITAL_PATHS = new Set<string>([
  "Leasehold improvements",
  "Tenant improvement allowance",
  "Property purchase",
]);

/** Operating income by source. Income lands as an inflow (negative amount). */
const INCOME_PATHS = new Set<string>([
  "Membership Income",
  "Membership revenue",
  "Salary & wages",
  "Investment proceeds",
  "Interest income",
  "Other income",
  "Rent income",
]);

export function categoryKind(fullPath: string | null | undefined): CategoryKind {
  // No category assigned yet → "unclassified", never "expense". Defaulting null to expense inflated
  // every P&L (52% of the ledger was uncategorized — ACCT-02); unclassified rows are excluded from
  // expense totals and surfaced as the review queue instead.
  if (!fullPath) return "unclassified";
  // Collapse path drift (leading/trailing or doubled whitespace) before matching, so a stray space
  // can't make a transfer/funding/capital path fall through to "expense" and leak into the P&L (BUG-08).
  const path = fullPath.trim().replace(/\s+/g, " ");
  if (!path) return "unclassified";
  if (TRANSFER_PATHS.has(path)) return "transfer";
  if (FUNDING_PATHS.has(path)) return "funding";
  if (CAPITAL_PATHS.has(path)) return "capital";
  if (INCOME_PATHS.has(path)) return "income";
  return "expense";
}

/** Backward-compatible set of every path that is not an operating expense (transfer + funding + capital). */
export const NON_EXPENSE_CATEGORY_PATHS = new Set<string>([
  ...TRANSFER_PATHS,
  ...FUNDING_PATHS,
  ...CAPITAL_PATHS,
]);
