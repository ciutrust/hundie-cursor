# Hundie Backlog

Prioritized work items. Check off when done in repo or remote Supabase.

**Principles:** Ledger-first (CSV is input only) · Human-in-the-loop always · Works with QuickBooks, not a budgeting app · Alex classifies now, Claudia later.

**Current focus:** Alex classifying Jan–Jun backlog; reports polish (see [PHASE3_PLAN.md](./PHASE3_PLAN.md))

**Agent reference:** [CLASSIFICATION.md](./CLASSIFICATION.md) — categories, non-expense rules, suggestion behavior, common patterns.

---

## Done — Month / Tax close (2026-06-26)

Auto zero-backlog readiness views (no manual lock).

- [x] **Month Close** (`/month-close`) — per-entity readiness for one month; closed when every active entity is at 0 backlog (unclassified + AMA); month picker; drill into an entity-month’s backlog
- [x] **Tax Close** (`/tax-close`) — year grid (entities × months) rolling month-close status up to a tax-close-ready year; click an open cell to clear it
- [x] Pure roll-ups in `lib/month-close.ts` (9 tests); `getMonthCloseMatrix(year)` reuses year-matrix + CPA-review-set helpers (no new tables); both behind auth middleware

---

## Done — Phase 2

- [x] AI suggestion v0 — top 3 from `qb_training_expenses` (GBSL)
- [x] Suggestions on transaction detail + bulk assign
- [x] Personal category chart (28 tax-aware categories)
- [x] Category drill-down + monthly entity matrix + MoM arrows
- [x] Uncategorized backlog view + nav tabs
- [x] Matrix pagination fix (Supabase 1000-row limit)

---

## Done — Phase 3

Classification UX, category gaps, learning loop foundations.

- [x] Personal suggestions from confirmed ledger history
- [x] Category × month matrix on entity drill-down
- [x] `suggestion_events` table + accept/reject logging
- [x] Unclassified & AMA filter on transaction list
- [x] GBSL non-expense: `Credit card payment`, `Refund / credit`
- [x] Rental: Bank fees, CC interest, tenant meals (ACAA + Pflugerville)
- [x] Personal: `Credit card interest (non-deductible)`
- [x] `lib/category-expense.ts` — exclude transfers/refunds from expense totals
- [x] [CLASSIFICATION.md](./CLASSIFICATION.md) operator + agent guide
- [x] **Amount-aware suggestions** — `rankAmountAwareMatches`, blend ranking, chip UX, `npm run verify:amount-aware`

---

## Done — Phase 1 review (2026-06-26)

**Status:** Shipped on `main` (2026-06-26). Repo + remote Supabase `ihciuqpiavxhbulfkwod`.

From [REVIEW-2026-06-26.md](./REVIEW-2026-06-26.md):

- [x] RLS lockdown — `20260629140000`; committed and applied remote
- [x] Auth guards: middleware `/reports` + `/settings`, server-action `getUser()`, category↔entity validation
- [x] CSV export reconcile columns (`counts_as_expense`, `expense_amount`) + formula injection hardening
- [x] **Import dedupe fix** — stable `import_hash` (no row index) + business-key skip on re-import; Keller one-time cleanup (130 dupes removed Jun 2026)
- [x] Vitest + core unit tests
- [x] Suggestion chip count shows real match count, not blended score
- [x] Review dashboard entity totals exclude backlog overlap (C8)
- [x] Personal card report `grandTotal` uses `isOperatingExpense`
- [x] **Quicksilver switch year** — GBSL through Jun 2026, Personal from Jul 2026 ([QUICKSILVER-DATE-RULE.md](./QUICKSILVER-DATE-RULE.md))
- [x] AI pre-classifier — Personal backlog, Ask AI panel, accept/reject, `/reports/ai-suggestions` ([AI-PRECLASSIFY.md](./AI-PRECLASSIFY.md))
- [ ] Remove `.qb-import-batches.json` from git history (S4)
- [ ] Archive dead MCP scripts to `scripts/archive/`

---

## Done — Review UX + categories (2026-07-01)

AI Review override loop, find-similar, mortgage/HELOC categories, dashboard perf.

- [x] **Mortgage/HELOC categories** — counted `Mortgage payment` + `HELOC payment` on Pflugerville, Austin ACAA, Personal; whole payment as one line (no principal/interest split — that's QBO) (`20260701120000`)
- [x] **AI Review inline assign + override** (`/review/ai`) — per-group Entity + Category dropdowns (prefilled from AI), per-row select, `Assign` button; keeping AI logs accept, overriding saves your category + logs reject; override still trains the engine (confirmed history + reject-credits-chosen). Replaces all-or-nothing "Accept AI"
- [x] **Accept-rate by source** (AI vs deterministic) on `/reports/ai-suggestions`
- [x] **Find similar** — per-row button on `/review/<entity>` narrows to same vendor-key + selects all for one-click bulk assign; `Similar:` chip clears (scope = current month/entity)
- [x] **Dashboard perf** — deduped `getEntitySummaries` (one call) + parallelized queries + DB indexes (`20260701130000`); review dashboard loads faster

---

## Now

- [ ] Alex classifies Jan–Jun backlog (operator work)
- [ ] Reports page + CSV export polish (CPA handoff)
- [ ] Tune progressive learning weights from `suggestion_events` volume

**Blocked / later:**

- [ ] Keller QBO read — waiting on Alex access
- [ ] `category_mappings` table (Hundie ↔ QB per company)
- [ ] Claudia auth + shared review

---

## Next — Phase 1 leftovers

- [ ] Manual intercompany flag (GBSL → Austin ACAA lease) — v1 manual
- [ ] Seed remaining card accounts (Home Depot, Best Buy, etc.)

---

## Later — Phase 4

- [ ] Bank account CSV import (full coverage)
- [ ] Time views: weekly, quarterly, yearly
- [ ] QuickBooks Online API read (GBSL)
- [ ] Plaid sync
- [ ] Entity detail pages (compliance — EINs stay local)
- [ ] Weekly email nudge — count of transactions still to categorize (per entity + total), soft re-engagement, link to `/review` (captured 2026-06-27)

---

## Later — Income & funding view (captured 2026-06-27)

**Detailed plan: [INCOME_CAPTURE_PLAN.md](./INCOME_CAPTURE_PLAN.md)** (2026-06-27) — backfill + going-forward,
bank deposits only, 5-kind category model (expense/income/transfer/funding/capital), expense-first UX.

Today the app is expense-only. Alex wants to see **where money comes in**, per entity, and to treat
intercompany transfers as **funding (capital injection)** — not income, not expense. Later work (Alex
is classifying expenses first), but capture the shape now.

**Income sources to break out, by entity:**
- **Personal** — salary (W-2), stock (dividends / capital gains / RSU vesting), interest, other
- **GBSL** — revenue by location: **GB Southlake** vs **GB Coppell**
- **Keller** — **JRoots** gym revenue
- **Austin ACAA + Pflugerville** — **rent income**; intercompany transfers in

**Intercompany transfers → "money injection / funding":** money moving between Alex's own entities is a
capital contribution / owner funding flow — kept OUT of the P&L. Surface in a funding view, not as income.

**Design notes / open questions:**
- **Income was dropped at import (CONFIRMED, 2026-06-27 trace).** Positive = outflow (charge); income is the
  inflow side. Every CSV parser skips payment rows, and for **checking/savings it drops ALL money-in**
  (`wf-csv-parser.mjs` `if (rawAmount >= 0) continue`); the Plaid path mirrors it (`shouldImportPlaidTxn` /
  `ledger-filter.ts` drop deposits for depository). **Re-importing will NOT recover income** — the rows were
  never stored. To capture income: decide a policy (which credits/deposits to keep), change the parser +
  Plaid filters, then re-import historical CSVs / re-sync Plaid. This is the first task for the income view.
- **Category "kind":** give each category an explicit role — `expense | income | transfer | funding` — instead
  of the implicit `NON_EXPENSE` set, so totals split cleanly into spend / money-in / movement.
- **Views:** a "Money in" breakdown mirroring the expense breakdown (gross in, by source, per entity) + a
  **Funding** view (capital injections / intercompany). Build on the existing (hidden) `/reports/intercompany`,
  which already tags intercompany legs; the old `/reports/funding` is a deprecated redirect to reuse the slug.
- Supersedes the Icebox "income / P&L" line.

---

## Icebox

- [ ] QuickBooks write-back
- [ ] Transaction splits
- [ ] Full intercompany automation
- [ ] Bills / due dates, income / P&L, CPA packet
- [ ] pgvector semantic matching

---

## Open questions (CPA / product)

- Tax treatment per entity (Schedule C vs E vs 1065)
- Intercompany recording detail for GBSL → Anita lease
- How far QB write-back should go and when to trust it
- Category granularity — full IRS lines vs simplified CPA mapping
