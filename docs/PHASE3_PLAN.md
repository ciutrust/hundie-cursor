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
5. **Category chart gaps** — transfer/non-expense categories, rental fees, Personal CC interest (see [CLASSIFICATION.md](./CLASSIFICATION.md))
6. **Non-expense totals** — `lib/category-expense.ts` excludes transfers/refunds from expense roll-ups

### Out of scope for v0

- Keller QBO import (blocked on access)
- `/reports` CSV export polish (partially shipped)
- pgvector / LLM
- **Amount-aware suggestion rules** — scoped below; Phase 3.3+, not v0

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
| 9 | Amount-aware suggestion rules | **Scoped — not built** |

---

## Success criteria

- [x] Personal transaction with vendor Alex classified before → sees top 3 from own history
- [x] GBSL suggestions unchanged (QB training)
- [x] Entity page shows category rows × Jan–Jun with MoM arrows
- [x] `npm run build` passes
- [x] Credit card payments classifiable without polluting expense totals
- [ ] Uncategorized backlog trends toward $0 as Alex classifies

---

## Amount-aware rules (Phase 3.3+ — scoped, not built)

### Problem

Some vendors map to **different categories depending on amount**, not description:

| Vendor | Amount | Category |
|--------|--------|----------|
| Gracie Barra Franc | ~$125 | Software (CRM subscription) |
| Gracie Barra Franc | ~$850–900 | Franchise Fees |

Today's matcher uses **vendor/description tokens only** (`extractSearchTokens` in `lib/suggestions/category-suggestions.ts`). After Alex classifies both patterns, suggestions may show both categories with low confidence — Alex must pick manually.

Google Ads vs Workspace **does** split correctly today because descriptions differ (`ADS` vs `Workspace` tokens).

### Proposed behavior (v1)

When ranking suggestions for a transaction:

1. Compute `vendor_key` (existing: `extractVendorSearchKey`).
2. Look up Alex's **confirmed classifications** for that `vendor_key` **grouped by amount bucket**.
3. Match current transaction amount to the best bucket:
   - **Exact band** — same amount seen ≥2 times → high confidence
   - **Range band** — e.g. `< $200`, `$200–$500`, `≥ $500` derived from confirmed history per vendor
   - **Fallback** — current token-only ranking if no bucket has enough examples
4. Blend bucket match with existing QB + ledger + event weights in `mergeWeightedSuggestions`.

### Amount bucket strategy (recommended)

```
Priority:
1. Exact amount match (±$0.01) if count ≥ 2 in confirmed history
2. Nearest predefined band with count ≥ 2 (bands computed per vendor from history quartiles or fixed thresholds Alex configures)
3. Vendor-only match (current behavior)
```

**Do not** silently auto-classify — always show top 3 chips; amount rule only **re-ranks** suggestions.

### Example: Gracie Barra

After Alex classifies:

- 3× $125 → Software  
- 5× $850/$900 → Franchise Fees  

A new $125 charge → Software ranked #1 (exact band). A new $875 charge → Franchise Fees #1.

### Dependencies

- [x] `suggestion_events` table (accept/reject logging)
- [x] Confirmed ledger query in `fetchLedgerRows`
- [ ] Minimum examples per bucket (suggest: ≥2 confirmations before bucket affects rank)
- [ ] UI copy: "Based on amount + your past picks for this vendor"

### Out of scope for amount-aware v1

- Auto-apply without human confirm
- Split transactions (one charge → two categories)
- LLM / semantic amount reasoning
- Cross-entity amount rules

### Build steps (when prioritized)

| Step | Work | Estimate |
|------|------|----------|
| 1 | `rankAmountAwareSuggestions(vendorKey, amount, confirmedRows)` | 0.5 d |
| 2 | Integrate into `fetchBlendedSuggestions` / `mergeWeightedSuggestions` | 0.5 d |
| 3 | Tests: Gracie Barra fixture, Google (no amount split needed) | 0.5 d |
| 4 | Chip UX: show "amount match" source label | 0.25 d |

**Total:** ~1.5–2 days after Phase 3 v0 backlog is closed.

### Success criteria

- [ ] Gracie Barra $125 → Software suggested first (after ≥2 prior $125 classifications)
- [ ] Gracie Barra $850 → Franchise Fees suggested first
- [ ] Google Ads still matches description tokens (no regression)
- [ ] Vendor with single amount pattern unchanged (backward compatible)

---

## Related

- [CLASSIFICATION.md](./CLASSIFICATION.md) — category charts, non-expense rules, operator cheat sheet
- [PHASE2_PLAN.md](./PHASE2_PLAN.md) — GBSL QB suggestions (done)
- [PERSONAL_CATEGORIES_AND_REPORTS_PLAN.md](./PERSONAL_CATEGORIES_AND_REPORTS_PLAN.md) — Personal chart + matrix (done)
