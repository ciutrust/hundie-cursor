# Hundie Backlog

Prioritized work items. Check off when done in repo or remote Supabase.

**Principles:** Ledger-first (CSV is input only) · Human-in-the-loop always · Works with QuickBooks, not a budgeting app · Alex classifies now, Claudia later.

**Current focus:** Phase 3 — learning loop + category trends (see [PHASE3_PLAN.md](./PHASE3_PLAN.md))

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

## Now — Phase 3

Learning loop + category trends.

- [x] Personal suggestions from confirmed ledger history
- [x] Category × month matrix on entity drill-down
- [ ] Track accept/reject for progressive learning
- [ ] Reports page + CSV export (CPA handoff)

**Blocked / later within Phase 3:**

- [ ] Keller QBO read — waiting on Alex access
- [ ] `category_mappings` table (Hundie ↔ QB per company)
- [ ] Progressive month-over-month learning (confirmed ledger weights)
- [ ] Claudia auth + shared review

---

## Next — Phase 1 leftovers

Small gaps before Phase 2 is merged-quality.

- [ ] Manual intercompany flag (GBSL → Austin ACAA lease) — v1 manual
- [ ] Seed remaining card accounts (Home Depot, Best Buy, etc.)
- [ ] Hundie-native categories for Personal / Pflugerville / Keller (beyond GBSL QB chart)

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
