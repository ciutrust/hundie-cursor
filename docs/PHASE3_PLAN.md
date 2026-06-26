# Phase 3 plan — Learning loop + category trends

> **Status:** In progress (June 2026)  
> **Principle:** Human-in-the-loop always — suggestions from Alex's confirmed work, never silent book changes.

---

## Goal

Close the classification backlog faster and see spending patterns by category over time.

---

## Scope

### In scope (v0)

1. **Personal category suggestions** — top 3 from Alex's confirmed Personal classifications (same vendor → last category used)
2. **GBSL suggestions** — keep QB training matcher (shipped Phase 2)
3. **Category × month matrix** on entity drill-down (`/review/gbsl`, `/review/personal`, …)
4. **Suggestion UX** — entity-aware copy (QB history vs your past picks)

### Out of scope for v0

- Keller QBO import (blocked on access)
- Suggestion accept/reject event log table (v0.1)
- `/reports` CSV export (v0.2)
- pgvector / LLM

---

## Build order

| # | Work | Status |
|---|------|--------|
| 1 | Personal suggestions from confirmed ledger | Done |
| 2 | Category × month matrix on entity page | Done |
| 3 | Suggestion event log (`suggestion_events`) | Planned |
| 4 | Reports page + CSV export | Planned |

---

## Success criteria

- [x] Personal transaction with vendor Alex classified before → sees top 3 from own history
- [x] GBSL suggestions unchanged (QB training)
- [x] Entity page shows category rows × Jan–Jun with MoM arrows
- [x] `npm run build` passes
- [ ] Uncategorized backlog trends toward $0 as Alex classifies

---

## Related

- [PHASE2_PLAN.md](./PHASE2_PLAN.md) — GBSL QB suggestions (done)
- [PERSONAL_CATEGORIES_AND_REPORTS_PLAN.md](./PERSONAL_CATEGORIES_AND_REPORTS_PLAN.md) — Personal chart + matrix (done)
