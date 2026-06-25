# Plan — Personal categories + entity/category drill-down + monthly view

> **Status:** Planning (June 2026)  
> **Principle:** Personal ledger is for *what the charge is* and *whether it might be tax-relevant or belong elsewhere*. Human still confirms; reclassify to GBSL/Keller/rentals when it’s really a business expense.

---

## Problem

1. **Personal** has no category chart — only GBSL has 50 QB categories. Personal cards hold ~half the ledger; everything stays “Unclassified.”
2. **Entity drill-down** shows a category summary but categories aren’t clickable — you can’t open “Advertising & Marketing” and see only those txs.
3. **Monthly view** is one month at a time via picker — no cross-month picture of “what did I spend per entity/category.”

---

## Part A — Personal category chart (tax-aware)

### Design

Use the same `categories` table as GBSL (`entity_id` = Personal). Each row has:

| Field | Purpose |
|-------|---------|
| `full_path` | Human-readable label (flat or `Group:Detail`) |
| `parent_id` | Optional grouping for UI |
| `name` | Short name |

**Optional v1.1 column:** `tax_hint text` — e.g. `schedule_a`, `none`, `reclassify_business`, `schedule_e` — for CPA export filters. Can defer and encode groups via `full_path` prefix for now.

### Category groups (4 top-level intents)

| Group | Intent |
|-------|--------|
| **Everyday personal** | Not deductible; track for cash flow |
| **Tax-related (personal)** | May appear on 1040 / Schedule A if you itemize |
| **Reclassify elsewhere** | Wrong entity — move to business or rental |
| **Non-expense** | Payments, transfers, refunds |

### Proposed Personal categories (seed list)

#### Everyday personal (not deductible)

| full_path | Notes |
|-----------|-------|
| Groceries & household | Food, Costco, Target household |
| Dining & entertainment | Restaurants, bars, personal fun |
| Clothing & personal care | |
| Personal travel & vacation | Flights, hotels — non-business |
| Subscriptions & memberships | Streaming, gym (personal), apps |
| Gifts (non-charitable) | |
| Pets | |
| Auto & fuel (personal use) | Default for personal cards unless business trip |
| Home maintenance & improvements | 512 Winding Ridge — not rental |
| Utilities — primary residence | Electric, water, internet (home) |
| Insurance — personal | Health, auto, homeowners (personal policy) |
| Childcare & family | |
| Education — personal | Non-business training |
| Hobbies & recreation | |

#### Tax-related (personal — confirm with CPA / itemization)

| full_path | Typical tax form | Notes |
|-----------|------------------|-------|
| Medical & dental | Schedule A | Only if itemizing; keep receipts |
| Charitable contributions | Schedule A | Cash + goods; separate from business charity |
| State & local taxes (SALT) | Schedule A | Property tax on primary home; SALT cap applies |
| Mortgage interest — primary home | Schedule A | 1098 from lender |
| Investment fees & tax prep (personal) | Schedule A / misc | Personal portion only |
| Casualty & theft loss | Schedule A | Rare |

#### Reclassify to another entity (workflow categories)

| full_path | Action |
|-----------|--------|
| → GBSL business expense | Change entity to `gbsl` + pick QB category |
| → Keller business expense | Change entity to `keller` |
| → Austin ACAA (136 Anita) | Change entity to `acaa-austin` |
| → Pflugerville rental | Change entity to `pflugerville` |
| Mixed / pending allocation | Notes required; split later (Phase 3) |

These are **staging labels** — goal is to zero them out by reclassifying to the right entity.

#### Non-expense (exclude from expense totals)

| full_path | Notes |
|-----------|-------|
| Credit card payment | Autopay, “payment thank you” |
| Transfer / Zelle (personal) | Moving money, not spend |
| Refund / credit | Negative or reversal |
| Intercompany — pending | Until matched to business books |

**Count:** ~28 categories (14 everyday + 6 tax-related + 4 reclassify + 4 non-expense).

### Build steps

1. Migration: `seed_personal_categories.sql` — insert categories for `entities.slug = 'personal'`.
2. UI: enable category picker + search (same as GBSL) when entity = Personal in reclassify/bulk.
3. Suggestions v0.2: Personal has no QB training — suggestions from **Alex’s past Personal classifications** (same vendor → last category). QB training stays GBSL-only.
4. Optional: show `tax_hint` badge on category in picker (“Schedule A candidate”).

### Open decisions for Alex

| Question | Recommendation |
|----------|----------------|
| Flat list vs grouped picker? | Grouped by 4 intents in UI |
| Include “→ GBSL” pseudo-categories or only entity dropdown? | **Both** — pseudo-category reminds you to move entity |
| Pflugerville vs Personal for Joshua Tree expenses? | Always **`pflugerville` entity** for Schedule E; Personal category only if mis-posted |
| Itemizing in 2026? | Categories still useful; CPA filters Schedule A group |

---

## Part B — Drill down: entity → category → transactions

### Current behavior

```
/review?month=2026-06          → entity totals (cards)
/review/gbsl?month=2026-06     → category breakdown (read-only) + full tx list
```

### Target behavior

```
/review?month=2026-06
  └─ /review/gbsl?month=2026-06
       └─ click "Advertising & Marketing" ($1,200)
            └─ /review/gbsl?month=2026-06&category=<uuid>
                 → header: GBSL · Advertising & Marketing · June 2026
                 → tx list filtered to that category only
                 → breadcrumb back to entity
```

**Unclassified bucket:** `category=unclassified` for txs with `category_id IS NULL`.

### Build steps

1. Make `CategoryBreakdown` rows clickable `Link`s with `category` query param.
2. Filter `getEntityTransactions` (or client filter) by `category` when param present.
3. Breadcrumb: `Review › GBSL › Advertising & Marketing`.
4. Show subtotal in header matching the category row.

**Effort:** ~0.5–1 day (mostly UI + query param).

---

## Part C — Monthly expense view (cross-month)

### Options

| Option | Description | Best for |
|--------|-------------|----------|
| **C — Monthly matrix** | Rows = entities (or categories); columns = Jan…Jun; cell = total | “How much per month per entity?” |
| **C2 — Month-over-month on entity page** | On `/review/gbsl`, small table: category × month | Entity-specific trends |
| **C3 — Dedicated `/reports` page** | Full report: by month, by entity, by category; export CSV | CPA handoff |

### Recommendation (phased)

**Phase 1 (quick):** Monthly matrix on `/review` below entity cards

- Rows = entities; columns = Jan–Dec for selected year
- Each cell: total + **↑ / ↓ vs prior month** (hover: “Higher/Lower than last month”)
- **↑ / ↓ vs next month** on past months only — hidden for current month and future months (no future data)
- Entity summary cards also show **vs last month** arrow on the selected month total
- Click cell → drill to that entity + month

**Phase 2:** Category × month on entity drill-down (heatmap or table).

**Phase 3:** `/reports` with CSV export (entity, category, tax_hint, notes).

### Query sketch

```sql
-- entity × month totals for 2026
select e.slug, date_trunc('month', t.transaction_date) as month,
       sum(t.amount) as total
from transactions t
join classifications c on c.transaction_id = t.id
join entities e on e.id = c.entity_id
where t.transaction_date >= '2026-01-01'
group by 1, 2;
```

### Build steps

1. `getMonthlyEntityTotals(year)` in `lib/queries/review.ts`.
2. `MonthlyEntityMatrix` component on `/review`.
3. Optional: toggle “show categories” for single selected entity.

**Effort:** Phase 1 matrix ~1 day; category × month ~1–2 days.

---

## Suggested build order

| # | Work | Depends on | Est. |
|---|------|------------|------|
| 1 | Seed Personal categories (migration) | — | 2 hr |
| 2 | Personal category picker in reclassify | #1 | 2 hr |
| 3 | Clickable category drill-down | — | 0.5–1 d |
| 4 | Monthly entity matrix on `/review` | — | 1 d |
| 5 | Personal suggestions from confirmed history | #1–2 | 1 d |
| 6 | Category × month on entity page | #3, #4 | 1–2 d |
| 7 | Reports + CSV export | #1–6 | 2–3 d |

**Parallel with current work:** Merge Phase 2 (GBSL suggestions) to main first, then #1–4 as **Phase 2.5**.

---

## Success criteria

- [ ] Personal txs can be categorized without scrolling 50 QB names — Personal-specific chart only
- [ ] “→ GBSL business expense” (or entity change) clears mis-posted personal charges
- [ ] From entity page, click category → see only those transactions
- [ ] From `/review`, see Jan–Jun totals per entity without changing month 6 times
- [ ] Notes + category survive for CPA export (future CSV)

---

## Related docs

- [PHASE2_PLAN.md](./PHASE2_PLAN.md) — GBSL suggestions (shipped on branch)
- [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md) — entities, cards, tax context
- [entities.md](./entities.md) — slug reference
- [Roadmap.md](./Roadmap.md) — phase timeline
