# Income Capture — Plan / Spec (2026-06-27)

## Why

Hundie drops every bank deposit at import — the importer keeps only outflows, so income was never
stored (confirmed by a code trace 2026-06-27). That means no income, no money-in view, no P&L. Goal:
capture **bank-deposit income** (backfill 2025+ and going forward), categorize it by source per entity,
and show money-in / net — **without disrupting expense categorization, which stays the primary experience.**

## Guiding principle: expense-first

Hundie is an expense-categorization tool **first**. Income and the other "kinds" are additive, secondary
lenses — not a restructure. Default mode = expense (unchanged). You opt **into** income/funding/capital
views. Menus and navigation stay expense-centric. We can pivot later; for now, expense is king.

## Scope

**In:**
- Bank-deposit income from connected checking/savings: salary, rent, GBSL/Keller revenue, interest,
  brokerage proceeds (which arrive as **wires into Personal**), and the landlord **TI allowance**.
- Backfill 2025+ from CSVs **and** capture going forward.
- A category **`kind`** model + income/funding/capital categories per entity.
- A **secondary** money-in view + net-per-entity + funding/capital view.

**Out:**
- Brokerage/investment account syncing (Plaid Investments). Brokerage income is captured only as the
  wires that land in Personal checking.
- Automatic income-categorization rules — income is classified manually + via the existing suggestion
  engine, exactly like expenses.
- GAAP P&L / depreciation schedules (the CPA's job). We **net** capital flows for visibility only.

## 1. Category `kind` model (the foundation)

Add a `kind` column to `categories`: `expense | income | transfer | funding | capital` (default `expense`).

Migrate existing categories:
- All current expense categories → `expense`.
- Today's `NON_EXPENSE` members → `transfer` (Credit card payment, Transfer / Zelle, the `→` redirects,
  Mixed / pending allocation, Security deposit movement) or `funding` (Owner Contribution / Distribution,
  Intercompany — pending).
- Leasehold improvements, property purchase, Tenant improvement allowance, Equipment → `capital`.

Replace the implicit `NON_EXPENSE` set + `isOperatingExpense` with **kind-aware** helpers:
- Operating **expense** total = `kind = 'expense'` and `amount > 0`.
- Operating **income** total = `kind = 'income'` and `amount < 0` (inflow), displayed as positive.
- `transfer` / `funding` / `capital` are excluded from both operating totals.

A compatibility shim keeps every existing expense total/report **byte-for-byte unchanged** (expense-first).
The existing `category-expense` test is rewritten against `kind` instead of the hardcoded path list.

## 2. Categories per entity (kind-tagged)

- **GBSL / Keller income** — mirror the QBO income accounts (GBSL already has *Membership Income*).
  Exact names confirmed with Alex / pulled from QBO.
- **Personal income** — Salary / wages, Investment proceeds (the wires), Interest income, Other income.
- **Austin ACAA / Pflugerville** — Rent income.
- **Funding** — Owner Contribution, Owner Distribution, Intercompany — pending.
- **Capital** — Leasehold improvements + **Tenant improvement allowance** (Keller), Property purchase,
  Equipment. (The buildout we noted and the landlord reimbursement net here, off the P&L.)

Seeded via migration; the income lists are confirmed with Alex before seeding.

## 3. Un-filter the importer (going forward)

- **CSV parsers** (checking/savings): stop dropping deposits; store inflows as **negative** (money in).
  Credit-card *payments* stay `transfer`, not income.
- **Plaid filter** (`lib/plaid/ledger-filter.ts` / `shouldImportPlaidTxn`): stop dropping depository
  money-in; bring inflows in as negatives.
- Imported inflows land **uncategorized**, and are kept **out of the expense backlog by sign** (see UX).
- Tests: a deposit row → negative amount; a categorized inflow resolves to `income` only via its category.

## 4. Backfill (the careful migration)

- Re-import the 2025+ CSVs with deposits enabled.
- **Dedup:** the business key (account + date + amount + normalized description) skips existing expense
  rows; only new inflow rows are added. Inflows carry distinct signs/amounts, so they can't collide with
  existing charges.
- **Dry-run first:** report how many income rows would be added (per account / entity) and **prove zero
  existing expense rows change** (row-count + hash comparison before/after). Apply only on Alex's OK.
- Plaid-synced accounts: `transactionsSync` is forward-cursor only, so historical income comes from the
  **CSV** re-import (Alex has the files). Respect CSV/Plaid **cutover dates** — no overlapping periods.

## 5. UX (expense-first; income as a secondary lens)

- **Default stays expense.** Dashboard cards, totals, and the classify backlog show **uncategorized
  outflows only** — inflows are excluded by sign, so the expense flow stays clean and primary.
- **Income is opt-in:**
  - A secondary **"Money in"** lens — income by source per entity (mirrors the expense breakdown).
  - **Net per entity** (income − expenses) as a secondary stat/section, never the headline.
  - **"Income to classify"** = uncategorized inflows, a separate small backlog (not mixed into expense
    classify).
  - A **Funding & capital** view (built on the existing `/reports/intercompany`): owner/intercompany
    funding + capital (buildout vs. TI allowance, netted).
- **Navigation:** no new competing top-level sections. Income surfaces as (a) a toggle / secondary tab in
  the review area, and (b) new entries in the existing Reports hub. The expense nav is unchanged.

## Sequencing (de-risk: foundation → forward → backfill → views)

1. **Kind model** — add `kind`, migrate existing categories, kind-aware totals. No change to expense
   behavior; tests stay green.
2. **Seed categories** — income / funding / capital per entity (confirm QBO income lists first).
3. **Un-filter importer** — parsers + Plaid filter capture deposits going forward, with tests.
4. **Backfill** — dry-run → verify zero-expense-change → apply.
5. **Views** — money-in / net / funding-capital, all secondary and expense-first.

Each phase ships independently. The risky step (4) lands last, after the foundation is proven.

## Risks & decisions

- **Backfill double-count** → business-key dedup + dry-run + before/after proof.
- **Income vs transfer vs funding vs capital ambiguity** → import uncategorized; Alex classifies; the
  suggestion engine assists; sign separates inflow from outflow at the UX layer.
- **Expense-first** → inflows excluded from the expense backlog/totals by sign; income UX is purely additive.
- **CSV/Plaid overlap** → cutover-date discipline (as with the expense import).
- **5 kinds vs 4** → keep `capital` distinct (matches how Alex thinks about buildout/TI vs. intercompany);
  can collapse into `funding` later if it's noise.

## Open questions

- Exact QBO income category names for GBSL and Keller (Alex provides / we pull).
- Which historical CSVs carry the deposit history (which accounts, what date range).
- Should net-P&L appear on the dashboard now, or stay in Reports? (Expense-first leans Reports for v1.)

## Testing

- Unit: parser deposit → negative amount; kind-aware expense/income totals; dedup skips existing rows on
  re-import; the rewritten `category-expense` kind test.
- A dry-run backfill script (income-row counts + zero-expense-change proof).
- `npm run build` + the existing 76 tests stay green.
