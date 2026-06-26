# Phase 2 plan — AI category suggestions

> **Status:** Shipped (June 2026). Extended in Phase 3 with confirmed-ledger blend, suggestion events, and amount-aware rules — see [PHASE3_PLAN.md](./PHASE3_PLAN.md).
> **Principle:** Human-in-the-loop always — AI suggests, Alex confirms. Never silent book changes.

---

## Goal

When Alex opens a transaction to classify, show **top 3 suggested categories** based on vendor/description patterns from:

1. **`qb_training_expenses`** (GBSL QuickBooks history, Nov 2022 – Jun 2026)
2. *(Later)* Alex's confirmed Hundie classifications on the same vendor

Alex taps a suggestion or picks manually — same reclassify flow as today.

---

## Scope for v0 (build this first)

### In scope

- Suggestion query on **transaction detail dialog** (and optionally bulk assign)
- **GBSL entity only** for category suggestions (50 QB categories already in DB)
- Match on normalized **vendor** + **description** against QB training rows
- Return **top 3 categories by frequency** (with count, e.g. "Meals & Entertainment · 12×")
- One-click apply suggestion → existing reclassify server action
- No auto-apply, no background jobs, no pgvector

### Out of scope for v0

- Keller QBO import (Alex will provide access later)
- Category suggestions for Personal / Keller / rental (need Hundie-native categories first)
- Progressive learning weights (design now, implement v0.2)
- Claudia auth
- pgvector / fuzzy ML

---

## Proposed build order

1. **`lib/suggestions/category-suggestions.ts`** — pure function: given `{ description, vendor, entitySlug }`, query training data, return top 3 `{ categoryId, fullPath, count, source: 'qb_training' }`
2. **Server action or RPC** — `getCategorySuggestions(transactionId)` loads tx, runs matcher, returns suggestions
3. **UI** — suggestion chips/buttons above category picker in reclassify dialog; selecting one pre-fills category dropdown
4. **Logging (optional v0)** — append to a simple `suggestion_events` table or JSON in `classification_history.notes` when Alex accepts/rejects (enables v0.2 learning)
5. **Verify** — known vendors (e.g. Google Ads → Advertising & Marketing); document test cases in PR

---

## Matching algorithm (v0)

```
1. Normalize vendor + description (lowercase, strip punctuation, collapse spaces)
2. Extract vendor token(s) — first meaningful word group, same as import parsers
3. Query qb_training_expenses WHERE entity = gbsl AND (
     vendor_name ILIKE %token% OR description ILIKE %token%
   )
4. GROUP BY category_id, category_name → ORDER BY count DESC LIMIT 3
5. If no match, return empty (no suggestion — manual only)
```

**Open decision for Alex:** exact substring match vs. require 2+ token overlap? Start with substring; tune after using it.

---

## Open questions (decide while building or after v0 dogfood)

| Question | Recommendation for v0 |
|----------|----------------------|
| Exact vs fuzzy vendor match? | Substring / ILIKE only |
| Keller tx — suggest from GBSL training? | No — entity must be GBSL for category suggestions |
| Weight QB training vs confirmed Hundie tx? | QB only in v0; add ledger weight in v0.2 |
| Show suggestions on bulk assign? | Nice-to-have after single-tx works |
| Store accept/reject for learning? | Yes, lightweight log table in v0.1 |

---

## Success criteria

- [ ] Open GBSL transaction with vendor "GOOGLE *ADS" → sees plausible top 3 QB categories
- [ ] Clicking suggestion fills category; Save works as today
- [ ] No suggestion shown when no training match (graceful empty state)
- [ ] `npm run build` passes
- [ ] Alex uses it for 1 week on real June 2026 GBSL charges — note hit rate informally

---

## Dependencies already in place

| Asset | Count / status |
|-------|----------------|
| `qb_training_expenses` | 3,577 rows (GBSL) |
| `categories` | 50 (GBSL QB chart) |
| `transactions` | ~1,882 |
| Reclassify + `classification_history` | Working |
| Phase 1 UI | `/review`, search, bulk assign |

---

## After v0 (Phase 2.1)

- Blend in confirmed Hundie classifications (same vendor → category Alex picked last time)
- Keller QBO import when access available
- Suggestion confidence indicator
- "Always use this category for vendor X" shortcut (still human-initiated)
