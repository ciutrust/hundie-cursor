/**
 * PLAIN-NODE MIRROR of lib/category-kind.ts.
 *
 * The QB import scripts (scripts/import-qb-*.mjs) run under plain `node`, NOT
 * `--experimental-strip-types`, so they cannot `import` the TypeScript lib/category-kind.ts.
 * This .mjs twin carries the same pure dispatch so those scripts can stamp `kind` at upsert time
 * (otherwise QB categories land with kind = NULL and mis-render on /categories and in reports).
 *
 * ⚠️ KEEP IN SYNC with lib/category-kind.ts — the path sets below must match byte-for-byte. The
 * `lib/category-expense.test.ts` "matches seeded non-expense paths byte-for-byte" test guards the
 * .ts side; scripts/lib/category-kind.test.mjs mirrors the classifier cases for this file.
 */

/** Money movement that is neither spend nor income — card payments, transfers, refunds, redirects. */
const TRANSFER_PATHS = new Set([
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
const FUNDING_PATHS = new Set([
  "Intercompany — pending",
  "Owner Contribution",
  "Owner Distribution",
  "Owners Equity",
  "Owners Equity:Owner Distribution",
]);

/** Fixed-asset flows, both directions (leasehold improvements, TI allowance, property purchase). */
const CAPITAL_PATHS = new Set([
  "Leasehold improvements",
  "Leasehold Improvements", // GBSL QB chart variant (capital I) — ACCT-13
  "Tenant improvement allowance",
  "Property purchase",
]);

/** Debt principal paydown — a balance-sheet liability reduction, NOT an expense. ACCT-08/11. */
const LIABILITY_PATHS = new Set([
  "Mortgage principal payment",
  "Mortgage principal — primary home",
  "Ford Motor Credit - F150:Principal",
]);

/** Real cash out that is NOT tax-deductible (IRC §162(f) fines & penalties). TAX-18. */
const NON_DEDUCTIBLE_PATHS = new Set([
  "Tax Penalty",
]);

/** Operating income by source. Income lands as an inflow (negative amount). */
const INCOME_PATHS = new Set([
  "Membership Income",
  "Membership revenue",
  "Salary & wages",
  "Investment proceeds",
  "Interest income",
  "Other income",
  "Rent income",
  "Intercompany — 136 Anita (income)", // Austin ACAA receives the GBSL lease — ACCT-07
]);

/**
 * Structural view of the kind→paths mapping. Mirror of the same export in lib/category-kind.ts.
 * Exported so tests/category-kind-parity.test.ts can assert this .mjs twin and the .ts stay in sync.
 * The private Sets above remain the source of truth for dispatch; this just re-exposes them as arrays.
 * Keys must match the .ts export exactly (same kinds, same members).
 */
export const CATEGORY_KIND_PATH_SETS = {
  transfer: [...TRANSFER_PATHS],
  funding: [...FUNDING_PATHS],
  capital: [...CAPITAL_PATHS],
  liability: [...LIABILITY_PATHS],
  non_deductible: [...NON_DEDUCTIBLE_PATHS],
  income: [...INCOME_PATHS],
};

/**
 * Classify a category by its full_path. Mirror of lib/category-kind.ts `categoryKind`.
 * @param {string | null | undefined} fullPath
 * @returns {"expense"|"income"|"transfer"|"funding"|"capital"|"liability"|"non_deductible"|"unclassified"}
 */
export function categoryKind(fullPath) {
  if (!fullPath) return "unclassified";
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
