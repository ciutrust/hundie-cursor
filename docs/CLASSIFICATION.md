# Classification guide — for agents and operators

> **Audience:** Cursor agents, Alex (classifier), future Claudia.  
> **Code truth:** `lib/category-expense.ts`, `lib/category-review.ts`, `lib/suggestions/category-suggestions.ts`, migrations under `supabase/migrations/`.

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

**Files:** `lib/suggestions/category-suggestions.ts`, `lib/actions/suggestions.ts`, `lib/suggestions/blend-ranking.ts`

1. Extract **vendor search tokens** from description (strips digits, normalizes `GOOGLE *ADS` → `google ads`).
2. Match against:
   - **QB training** (`qb_training_expenses`) — GBSL only
   - **Confirmed ledger** — same entity, same vendor tokens
   - **Suggestion events** — accept/reject weights (`suggestion_events` table)
3. Return top 3 with confidence (high / medium / low).

**What suggestions learn today:** vendor/description tokens → category (same merchant string family).

**What suggestions do NOT learn today:** amount-based rules (see [PHASE3_PLAN.md](./PHASE3_PLAN.md#amount-aware-rules-phase-33--scoped-not-built)).

---

## Migrations reference (Jun 2026 category work)

| Migration | What |
|-----------|------|
| `20260626120000_seed_personal_categories.sql` | Personal chart (28 categories) |
| `20260627120000_rental_categories_and_account_settings.sql` | Austin ACAA + Pflugerville Schedule E chart |
| `20260629120000_add_transfer_and_rental_categories.sql` | GBSL transfer categories, Personal CC interest, rental Bank fees / CC interest / meals |

---

## Related docs

- [PHASE3_PLAN.md](./PHASE3_PLAN.md) — learning loop, amount-aware rules scope
- [PERSONAL_CATEGORIES_AND_REPORTS_PLAN.md](./PERSONAL_CATEGORIES_AND_REPORTS_PLAN.md) — Personal chart design
- [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md) — QB import rules, entity model
