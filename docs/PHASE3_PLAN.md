# Phase 3 plan — Learning loop + category trends

> **Status:** In progress (June 2026) — Phase 3.3 amount-aware suggestions shipped on `feature/amount-aware-suggestions`
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
5. **Category chart gaps** — transfer/non-expense categories, rental fees, Personal CC interest (see [CLASSIFICATION.md](./CLASSIFICATION.md))
6. **Non-expense totals** — `lib/category-expense.ts` excludes transfers/refunds from expense roll-ups

### Out of scope for v0

- Keller QBO import (blocked on access)
- `/reports` CSV export polish (partially shipped)
- pgvector / LLM

---

## Build order

| # | Work | Status |
|---|------|--------|
| 1 | Personal suggestions from confirmed ledger | Done |
| 2 | Category × month matrix on entity page | Done |
| 3 | Suggestion event log (`suggestion_events`) | Done (table + logging) |
| 4 | Reports page + CSV export | Partial |
| 5 | Unclassified & AMA filter on transaction list | Done |
| 6 | GBSL `Credit card payment` + `Refund / credit` (non-expense) | Done |
| 7 | Rental Bank fees / CC interest / meals; Personal CC interest | Done |
| 8 | `lib/category-expense.ts` — exclude non-expense from totals | Done |
| 9 | Amount-aware suggestion rules | Done |

---

## Success criteria

- [x] Personal transaction with vendor Alex classified before → sees top 3 from own history
- [x] GBSL suggestions unchanged (QB training)
- [x] Entity page shows category rows × Jan–Jun with MoM arrows
- [x] `npm run build` passes
- [x] Credit card payments classifiable without polluting expense totals
- [ ] Uncategorized backlog trends toward $0 as Alex classifies

---

## Amount-aware rules (Phase 3.3 — shipped)

### Problem

Some vendors map to **different categories depending on amount**, not description:

| Vendor | Amount | Category |
|--------|--------|----------|
| Gracie Barra Franc | ~$125 | Software (CRM subscription) |
| Gracie Barra Franc | ~$850–900 | Franchise Fees |

### Implementation

**Files:**

- `lib/suggestions/amount-aware-ranking.ts` — `rankAmountAwareMatches`, `representativeBulkAmount`
- `lib/suggestions/blend-ranking.ts` — amount score blended with QB + ledger + events
- `lib/actions/suggestions.ts` — passes `amount` + `vendorKey`; filters ledger by vendor key
- `components/review/category-suggestion-chips.tsx` — "Amount match" badge + exact/similar hint

**Behavior:**

1. Filter confirmed ledger rows to same `vendor_key` as current transaction.
2. Group by exact amount (±$0.01); require **≥2** confirmations per bucket.
3. **Exact bucket** match → weight 6× per count; **nearest bucket** → weight 4×.
4. Re-ranks top 3 chips only — never auto-applies.
5. Bulk assign uses amount when **>50%** of selected txs share the same amount.

**Verify:** `npm run verify:amount-aware`

### Success criteria

- [x] Gracie Barra $125 → Software suggested first (after ≥2 prior $125 classifications)
- [x] Gracie Barra $850 → Franchise Fees suggested first (nearest bucket)
- [x] Google Ads still matches description tokens (no regression)
- [x] Vendor with single amount pattern unchanged (backward compatible)

---

## Related

- [CLASSIFICATION.md](./CLASSIFICATION.md) — category charts, non-expense rules, operator cheat sheet
- [PHASE2_PLAN.md](./PHASE2_PLAN.md) — GBSL QB suggestions (done)
- [PERSONAL_CATEGORIES_AND_REPORTS_PLAN.md](./PERSONAL_CATEGORIES_AND_REPORTS_PLAN.md) — Personal chart + matrix (done)
