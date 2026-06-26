# Classification guide — for agents and operators

> **Audience:** Cursor agents, Alex (classifier), future Claudia.  
> **Code truth:** `lib/category-expense.ts`, `lib/category-review.ts`, `lib/transaction-filters.ts`, `lib/suggestions/category-suggestions.ts`, `lib/suggestions/amount-aware-ranking.ts`, `lib/suggestions/blend-ranking.ts`, migrations under `supabase/migrations/`.

Human-in-the-loop always — suggestions help; Alex confirms every category.

---

## Category charts by entity

### GBSL (`gbsl`)

- **Source:** QuickBooks chart (~47 expense categories) from `import:qb-gbsl` + Hundie-native **non-expense** rows.
- **QB-aligned expenses:** Advertising & Marketing, Franchise Fees, Software, Contract Labor, Meals & Entertainment, etc. (see `docs/PROJECT_CONTEXT.md`).
- **Hundie-only (non-expense):**
  - `Credit card payment` — checking → card/LOC payments; **not P&L**
  - `Refund / credit` — customer refunds, reversals; **not P&L**
- **CPA review:** `Ask My Accountant` — imported from QB; still needs Alex's call (treated as review backlog, not final).

### Personal (`personal`)

28 tax-aware categories — see `supabase/migrations/20260626120000_seed_personal_categories.sql`.

**Notable:**

| Category | Use |
|----------|-----|
| `Credit card payment` | Autopay / online transfer to pay a card |
| `Transfer / Zelle (personal)` | Moving money, not spend |
| `Refund / credit` | Refunds, credits |
| `Credit card interest (non-deductible)` | CC interest on personal cards (added Jun 2026) |
| `→ GBSL business expense` | Staging — reclassify to GBSL + QB category |

### Austin ACAA & Pflugerville (`acaa-austin`, `pflugerville`)

Schedule E rental charts — see `supabase/migrations/20260627120000_rental_categories_and_account_settings.sql` plus `20260629120000_add_transfer_and_rental_categories.sql`.

**Added Jun 2026:**

| Category | Use |
|----------|-----|
| `Bank fees` | Past due fees, late fees on rental CC |
| `Interest expense (credit card)` | CC purchase interest (not mortgage) |
| `Meals & entertainment (rental)` | Tenant meals, property-related dining |

**Non-expense (already seeded):** `Refund / credit`, `Mortgage principal payment`, `Security deposit movement`, reclassify staging rows.

---

## Non-expense vs operating expense

**File:** `lib/category-expense.ts`

Some categories move money or stage reclassification — they must **not** inflate expense totals on `/review`, entity summaries, or reports.

```typescript
// isOperatingExpense(amount, categoryFullPath) === true only when:
//   amount > 0 AND category NOT IN NON_EXPENSE_CATEGORY_PATHS
```

**Excluded paths (canonical list in code):**

- `Credit card payment`
- `Transfer / Zelle (personal)`
- `Refund / credit`
- `Intercompany — pending`
- `Mortgage principal payment`
- `Security deposit movement`
- `→ GBSL business expense`, `→ Keller business expense`, `→ Austin ACAA (136 Anita)`, `→ Pflugerville rental`, `→ Personal (mis-posted)`
- `Mixed / pending allocation`

**Where exclusion applies:** `getEntitySummaries`, entity page header total, monthly entity matrix YTD, `getReportByEntity`.

**Where exclusion does NOT apply:** category breakdown rows, category × month matrix (transfers show in their own row — correct for drill-down).

**QuickBooks alignment:** QB export skips Credit Card Payments and account-to-account transfers. Hundie classifies checking-side payment rows as `Credit card payment` so they stay out of expense roll-ups while remaining searchable.

### Refunds & credits — import behavior (C2, since 0.2.2)

Card **refunds/credits** now import as **negative-amount** rows. (Before this change all five issuer parsers dropped them at parse time, so `Refund / credit` was unreachable from card data.) Practically:

- Classify a refund as **`Refund / credit`**. The negative amount keeps it out of the `amount > 0` expense totals automatically; it still shows in the category drill-down and the CSV export (`counts_as_expense = no`).
- Card **payments** (paying off the card) and **checking deposits / income** are still dropped at import — they are not spend.
- Totals stay **gross**: a refund is a visible row, not auto-netted against the original charge. Net spend = charges − refunds; the netting and tax treatment happen in **QBO**, not here (Hundie is expense control, not the books).
- **Backfill:** to pull in refunds from CSVs imported before this change, **re-import the card CSVs** — dedupe is safe, so existing charges are not duplicated (`npm run import:cards`).

---

## Review backlog

**File:** `lib/category-review.ts`

Transactions need review when:

- `category_id IS NULL` (Unclassified), or
- category is `Ask My Accountant` (CPA review bucket)

**UI:** `/review/unclassified` · **Unclassified & AMA** toggle next to Select all on transaction lists (`reviewBacklogOnly` in `lib/transaction-filters.ts`).

---

## Operator cheat sheet (common patterns)

| Pattern | Entity | Category |
|---------|--------|----------|
| `GOOGLE *ADS…` | GBSL (or Personal → reclassify) | Advertising & Marketing |
| `GOOGLE *Workspace…` | GBSL / Personal | Software or Dues & Subscriptions |
| `ONLINE TRANSFER … TO SIGNIFY/VISA …` | GBSL | **Credit card payment** (not Labor) |
| `ONLINE TRANSFER … TO BUSINESSLINE …` | GBSL | **Credit card payment** (LOC treated as card) |
| `ZELLE … REFUND` | entity of original charge | **Refund / credit** |
| `IN *GRACIE BARRA …` ~$125 | GBSL | **Software** (CRM) |
| `IN *GRACIE BARRA …` ~$850–900 | GBSL | **Franchise Fees** |
| `PAST DUE FEE` on rental CC | acaa-austin / pflugerville | **Bank fees** |
| `INTEREST CHARGE:PURCHASES` on rental CC | acaa-austin / pflugerville | **Interest expense (credit card)** |
| Personal CC interest | personal | **Credit card interest (non-deductible)** |

**Notes field:** Use for context (tenant name, refund reason, CPA questions) — saved on classification, included in CSV export.

---

## How suggestions work (Phase 2–3)

**Files:** `lib/suggestions/category-suggestions.ts`, `lib/suggestions/amount-aware-ranking.ts`, `lib/actions/suggestions.ts`, `lib/suggestions/blend-ranking.ts`

1. Extract **vendor search tokens** from description (strips digits, normalizes `GOOGLE *ADS` → `google ads`).
2. Match against:
   - **QB training** (`qb_training_expenses`) — GBSL only
   - **Confirmed ledger** — same entity, same vendor tokens
   - **Suggestion events** — accept/reject weights (`suggestion_events` table)
   - **Amount buckets** — same vendor key, grouped by exact/nearest amount (≥2 prior confirmations)
3. Return top 3 with confidence (high / medium / low). Source may be `amount_match` when amount bucket dominates.

**Amount-aware (shipped on `feature/amount-aware-suggestions`):**

- Same vendor, different category by amount (Gracie Barra $125 = Software, $850 = Franchise Fees)
- Requires **≥2** prior confirmations at that amount bucket before re-ranking kicks in
- Bulk assign uses amount when **>50%** of selected txs share the same amount
- Verify: `npm run verify:amount-aware` · Spec: [PHASE3_PLAN.md § Amount-aware](./PHASE3_PLAN.md#amount-aware-rules-phase-33--shipped)

**Description-token learning:** Google Ads vs Workspace (`ADS` vs `Workspace` substrings).

---

## Migrations reference (Jun 2026 category work)

| Migration | What |
|-----------|------|
| `20260626120000_seed_personal_categories.sql` | Personal chart (28 categories) |
| `20260627120000_rental_categories_and_account_settings.sql` | Austin ACAA + Pflugerville Schedule E chart |
| `20260629120000_add_transfer_and_rental_categories.sql` | GBSL transfer categories, Personal CC interest, rental Bank fees / CC interest / meals |

---

## Related docs

- [PHASE3_PLAN.md](./PHASE3_PLAN.md) — learning loop, amount-aware rules (shipped)
- [PERSONAL_CATEGORIES_AND_REPORTS_PLAN.md](./PERSONAL_CATEGORIES_AND_REPORTS_PLAN.md) — Personal chart design
- [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md) — QB import rules, entity model
