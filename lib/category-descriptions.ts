// Reference content for the /categories page. `kind` already determines P&L treatment, so the
// page derives the P&L badge from KIND_INFO; DESCRIPTIONS adds plain-English "when to use" notes
// for the non-obvious categories (the everyday expense/income ones are self-explanatory).

export type CategoryKind =
  | "income"
  | "expense"
  | "non_deductible"
  | "transfer"
  | "funding"
  | "capital"
  | "liability"
  | "unclassified";

export const KIND_INFO: Record<CategoryKind, { label: string; pnl: "income" | "expense" | "no" | "flag"; blurb: string }> = {
  income: { label: "Income", pnl: "income", blurb: "Money earned — counts as income on the P&L." },
  expense: { label: "Expense", pnl: "expense", blurb: "Money spent on the business/household — a deductible expense on the P&L." },
  non_deductible: { label: "Non-deductible", pnl: "flag", blurb: "Real money spent, but NOT tax-deductible — shown separately and kept out of deductible expense totals." },
  transfer: { label: "Transfer", pnl: "no", blurb: "Money moving between your own accounts/entities. Never an expense or income — excluded from the P&L." },
  funding: { label: "Funding / Equity", pnl: "no", blurb: "Owner capital or inter-entity funding (equity in/out). A balance-sheet movement, not P&L." },
  capital: { label: "Capital / Asset", pnl: "no", blurb: "A capitalized purchase or improvement — an asset that depreciates over time, not an immediate expense." },
  liability: { label: "Liability", pnl: "no", blurb: "Loan principal or a payable — pays down debt on the balance sheet. (Only the interest portion is an expense.)" },
  unclassified: { label: "Unclassified", pnl: "no", blurb: "Not yet categorized — counts nowhere until you classify it." },
};

export const KIND_ORDER: CategoryKind[] = [
  "income", "expense", "non_deductible", "transfer", "funding", "capital", "liability", "unclassified",
];

// full_path -> description. Shared across entities where the meaning is identical.
export const DESCRIPTIONS: Record<string, string> = {
  "Transfer / Zelle (personal, not P&L)":
    "Moving YOUR OWN money — between your accounts (e.g. to savings) or funding a business you own. NOT for paying someone for a service (that's an expense like Contract Labor). Excluded from P&L.",
  "Credit card payment":
    "Paying down a credit-card balance. A cash transfer to the card — the original purchases on the card are the expenses, not the payment.",
  "Credit card rewards / cash back":
    "Card reward / cash-back credits. Treated as a rebate, not income. Excluded from P&L.",
  "Refund / credit": "A refund or merchant credit reversing a prior charge. Nets against spend; not income.",
  "Owner Contribution": "Owner putting personal money INTO this entity (capital in). Equity, not income — excluded from P&L. Pairs with a 'Transfer' out on the funding account.",
  "Owner Distribution": "Money taken OUT of the entity to the owner (a draw). Equity, not an expense — excluded from P&L.",
  "Owners Equity": "Owner-equity movements (contributions / draws). Balance sheet, not P&L.",
  "Owners Equity:Owner Distribution": "Money taken OUT of the entity to the owner (a draw). Equity, not an expense — excluded from P&L.",
  "Intercompany — pending": "A transfer between your entities awaiting pairing with its other half. A holding bucket — excluded from P&L until reconciled.",
  "Sales Tax Payable": "Sales tax you collected and owe to the state — a liability you remit, not income or expense.",
  "Security deposit movement": "Tenant security deposit held or returned — a liability you hold, not rental income.",
  "Mixed / pending allocation": "Holding bucket for charges that mix purposes or need a manual look — allocate before you finalize.",
  "Ask My Accountant": "A parking spot for anything you're unsure about — flag it for your accountant and revisit before close.",
  "Property purchase": "Buying the property itself — a capitalized asset (depreciated), not an expense.",
  "Leasehold Improvements": "Build-out / improvements to a leased space — a capitalized asset (depreciated), not an immediate expense.",
  "Leasehold improvements": "Build-out / improvements to a leased space — a capitalized asset (depreciated), not an immediate expense.",
  "Tenant improvement allowance": "Landlord allowance toward your build-out — offsets the improvement cost; capital, not income.",
  "Tax Penalty": "Tax penalties / fines — real money spent but NOT tax-deductible.",
  "Mortgage principal payment": "The PRINCIPAL portion of a mortgage payment — pays down the loan (balance sheet). Only the INTEREST portion is a deductible expense.",
  "Mortgage principal — primary home": "The PRINCIPAL portion of your home mortgage — pays down the loan. Not deductible; the interest portion is.",
  "Ford Motor Credit - F150:Principal": "The PRINCIPAL portion of the F-150 loan payment — pays down the loan, not an expense. The interest portion is the expense.",
  "Tournament Prep": "Athlete preparation costs for competition (recovery, medical, camps) — a business expense.",
  "Tournament Fees": "Competition entry / registration fees — a business expense.",
  "Franchise Fees": "Gracie Barra franchise / royalty fees — a business expense.",
  "Cost of Goods Sold:School Wear": "Apparel & gear inventory you resell at the academy — cost of goods sold.",
  "Cost of Goods Sold": "Inventory / goods you resell — cost of goods sold.",
  "→ Austin ACAA (136 Anita)": "Intercompany pointer: this charge actually belongs to Austin ACAA — routed there, not counted on this entity's P&L.",
  "→ GBSL business expense": "Intercompany pointer: this charge is really a GBSL business expense — routed to GBSL, not counted here.",
  "→ Keller business expense": "Intercompany pointer: this charge is really a Keller business expense — routed to Keller, not counted here.",
  "→ Pflugerville rental": "Intercompany pointer: this charge belongs to the Pflugerville rental — routed there, not counted here.",
  "→ Personal (mis-posted)": "Intercompany pointer: a personal charge that hit a business card — routed back to Personal, not a business expense.",
};
