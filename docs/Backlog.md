# Hundie Backlog

Prioritized work items. Check off when done in repo or remote Supabase.

**Principles:** Ledger-first (CSV is input only) · Human-in-the-loop always · Works with QuickBooks, not a budgeting app · Alex classifies now, Claudia later.

**Current focus:** Phase 3 — learning loop + category trends (see [PHASE3_PLAN.md](./PHASE3_PLAN.md))

**Agent reference:** [CLASSIFICATION.md](./CLASSIFICATION.md) — category charts, non-expense rules, common patterns.

---

## Done — Phase 2

AI suggestions + reporting foundation.

- [x] AI suggestion v0 — top 3 categories from `qb_training_expenses` (GBSL)
- [x] Show suggestions on transaction detail / bulk assign dialog
- [x] Personal category chart (28 tax-aware categories)
- [x] Category drill-down + monthly entity matrix + MoM arrows
- [x] Uncategorized backlog view + nav tabs
- [x] Fix matrix pagination (Supabase 1000-row limit)

---

## Done — Phase 3 (partial)

Classification UX + category gaps closed while Alex works backlog.

- [x] Personal suggestions from confirmed ledger history
- [x] Category × month matrix on entity drill-down
- [x] `suggestion_events` table + accept/reject logging
- [x] Unclassified & AMA filter on transaction list
- [x] GBSL non-expense: `Credit card payment`, `Refund / credit`
- [x] Rental: Bank fees, CC interest, tenant meals (ACAA + Pflugerville)
- [x] Personal: `Credit card interest (non-deductible)`
- [x] `lib/category-expense.ts` — exclude transfers/refunds from expense totals
- [x] [CLASSIFICATION.md](./CLASSIFICATION.md) operator + agent guide

---

## Now — Phase 3

- [ ] Alex classifies Jan–Jun backlog (operator work)
- [ ] Reports page + CSV export polish (CPA handoff)
- [ ] Progressive learning weights tuned from `suggestion_events` volume

**Blocked / later within Phase 3:**

- [ ] Keller QBO read — waiting on Alex access
- [ ] `category_mappings` table (Hundie ↔ QB per company)
- [ ] Claudia auth + shared review

---

## Next — Phase 3.3 (scoped, not started)

**Amount-aware suggestion rules** — same vendor, different category by amount.

- [ ] `rankAmountAwareSuggestions(vendorKey, amount, confirmedRows)`
- [ ] Blend into `mergeWeightedSuggestions` (re-rank only; never auto-apply)
- [ ] Tests: Gracie Barra $125 → Software, $850 → Franchise Fees
- [ ] UI: "amount match" source on suggestion chips

**Full spec:** [PHASE3_PLAN.md § Amount-aware rules](./PHASE3_PLAN.md#amount-aware-rules-phase-33--scoped-not-built)  
**Estimate:** ~1.5–2 days after Phase 3 v0 backlog closed.

**Known case:** Gracie Barra Franc — $125 = Software (CRM), $850–900 = Franchise Fees. Google Ads vs Workspace already splits by description tokens (no amount rule needed).

---

## Next — Phase 1 leftovers

- [ ] Manual intercompany flag (GBSL → Austin ACAA lease) — v1 manual
- [ ] Seed remaining card accounts (Home Depot, Best Buy, etc.)

---

## Later — Phase 4

- [ ] Bank account CSV import (full coverage, not just outflows)
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
