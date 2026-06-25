# Hundie Backlog

Prioritized work items. Check off when done in repo or remote Supabase.

**Principles:** Ledger-first (CSV is input only) · Human-in-the-loop always · Works with QuickBooks, not a budgeting app · Alex classifies now, Claudia later.

**Current focus:** Phase 2 — AI suggestions (see [PHASE2_PLAN.md](./PHASE2_PLAN.md))

---

## Done — Phase 1

Data foundation, backfill, and review UI.

- [x] GitHub repo + Supabase project connected
- [x] Entity registry, ledger schema, QB categories + training schema
- [x] Card CSV parsers + import CLI (`import:cards`, dry-run, verify)
- [x] Initial card/checking backfill — 1,730 tx (13 accounts, Jan–Jun 2026)
- [x] QB GBSL import — 3,577 training expenses, 50 categories
- [x] Keller + GBSL Claudia WF accounts (4) + import — 152 tx, parent/child CC dedupe
- [x] `classification_history` + RLS write policies
- [x] Next.js monthly review UI + Supabase Auth
- [x] Entity summary → drill-down → reclassify (single + bulk)
- [x] Search: text, amount operators, category + account multiselect
- [x] GBSL category picker; personal/rental categories stubbed in UI

**Ledger snapshot:** ~1,882 transactions · 17 accounts · Keller entity live (130 tx)

---

## Now — Phase 2

AI suggestions + training loop (human confirms always).

- [ ] AI suggestion v0 — top 3 categories from `qb_training_expenses` vendor/description match (GBSL first)
- [ ] Show suggestions on transaction detail / bulk assign dialog
- [ ] Track accept/reject for future progressive learning
- [ ] Document suggestion accuracy + open questions (see PHASE2_PLAN.md)

**Blocked / later within Phase 2:**

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

## Later — Phase 3

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
