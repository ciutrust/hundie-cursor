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
  | "liability"
  | "non_deductible"
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
  "Leasehold Improvements", // GBSL QB chart variant (capital I) — ACCT-13
  "Tenant improvement allowance",
  "Property purchase",
]);

/**
 * Debt principal paydown — a balance-sheet liability reduction, NOT an expense. The matching
 * INTEREST line stays "expense" (deductible). ACCT-08 / ACCT-11, TAX-02 / TAX-06. Excluded from
 * the deductible-expense total (countsAsExpense=false), so principal leaves the P&L.
 */
const LIABILITY_PATHS = new Set<string>([
  "Mortgage principal payment", // acaa-austin / pflugerville rentals
  "Mortgage principal — primary home", // personal primary residence (em-dash U+2014)
  "Ford Motor Credit - F150:Principal", // GBSL vehicle loan (QB subaccount of the combined loan)
]);

/**
 * Real cash out that is NOT tax-deductible (IRC §162(f) fines & penalties). Excluded from the
 * deductible-expense total (countsAsExpense=false), so it leaves the P&L. TAX-18.
 */
const NON_DEDUCTIBLE_PATHS = new Set<string>([
  "Tax Penalty", // GBSL
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
  "Intercompany — 136 Anita (income)", // Austin ACAA receives the GBSL lease — ACCT-07 (em-dash U+2014)
]);

/**
 * Structural view of the kind→paths mapping, exported so a cross-implementation parity test can
 * assert this file and its plain-node twin (scripts/lib/category-kind.mjs) stay byte-for-byte in
 * sync (tests/category-kind-parity.test.ts). Do NOT drive the dispatch off this — the private Sets
 * above remain the source of truth; this is the same data re-exposed as arrays for comparison.
 * Keys must match the .mjs export exactly (same kinds, same members).
 */
export const CATEGORY_KIND_PATH_SETS = {
  transfer: [...TRANSFER_PATHS],
  funding: [...FUNDING_PATHS],
  capital: [...CAPITAL_PATHS],
  liability: [...LIABILITY_PATHS],
  non_deductible: [...NON_DEDUCTIBLE_PATHS],
  income: [...INCOME_PATHS],
} as const;

/**
 * Display kind for a category row: use its stored `kind` when set, otherwise derive it from
 * `full_path`. QB-imported categories can land with `kind = NULL` (the importer historically omitted
 * it — C11); this makes them render under their TRUE P&L kind (matching what reports compute) instead
 * of collapsing every QB category into "unclassified". Pure so the /categories page can stay a thin
 * shell and this stays unit-testable.
 */
export function categoryDisplayKind(c: {
  kind: CategoryKind | null | undefined;
  full_path: string | null | undefined;
}): CategoryKind {
  return c.kind ?? categoryKind(c.full_path);
}

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
  if (LIABILITY_PATHS.has(path)) return "liability";
  if (NON_DEDUCTIBLE_PATHS.has(path)) return "non_deductible";
  if (INCOME_PATHS.has(path)) return "income";
  return "expense";
}

/**
 * Backward-compatible set of every path that is not an operating expense
 * (transfer + funding + capital + liability + non_deductible). Income stays excluded from this
 * union by convention — income is an additive lens, not a "non-expense" exclusion path.
 */
export const NON_EXPENSE_CATEGORY_PATHS = new Set<string>([
  ...TRANSFER_PATHS,
  ...FUNDING_PATHS,
  ...CAPITAL_PATHS,
  ...LIABILITY_PATHS,
  ...NON_DEDUCTIBLE_PATHS,
]);
