# Hundie Backlog

Prioritized work items. Check off when done in repo or remote Supabase.

**Principles:** Ledger-first (CSV is input only) · Human-in-the-loop always · Works with QuickBooks, not a budgeting app · Alex classifies now, Claudia later.

**Current focus:** Alex classifying Jan–Jun backlog; reports polish (see [PHASE3_PLAN.md](./PHASE3_PLAN.md))

**Agent reference:** [CLASSIFICATION.md](./CLASSIFICATION.md) — categories, non-expense rules, suggestion behavior, common patterns.

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

From [REVIEW-2026-06-26.md](./REVIEW-2026-06-26.md):

- [x] RLS lockdown merged (`20260629140000`)
- [x] Auth guards: middleware `/reports` + `/settings`, server-action `getUser()`, category↔entity validation
- [x] CSV export reconcile columns (`counts_as_expense`, `expense_amount`) + formula injection hardening
- [x] `import_hash` disambiguation via issuer ref + source row index
- [x] Vitest + core unit tests
- [x] Suggestion chip count shows real match count, not blended score
- [x] Review dashboard entity totals exclude backlog overlap (C8)
- [x] Personal card report `grandTotal` uses `isOperatingExpense`
- [x] **Quicksilver switch year** — GBSL through Jun 2026, Personal from Jul 2026 ([QUICKSILVER-DATE-RULE.md](./QUICKSILVER-DATE-RULE.md))
- [ ] Refund import policy (C2)
- [ ] AI pre-classifier backlog (PROMPT-3)
- [ ] Remove `.qb-import-batches.json` from git history (S4)
- [ ] Archive dead MCP scripts to `scripts/archive/`

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
