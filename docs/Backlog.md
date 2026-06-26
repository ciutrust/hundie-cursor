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
