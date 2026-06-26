# Hundie — Project Context & Handoff

> Dump of planning conversation (June 2026). Give this file to the agent when starting work in this repo.

---

## One line

Hundie sorts every charge across businesses, rental properties, and personal life into the right **entity** and **tax category** — a little each week — so that at tax time your books are already clean, per-entity, and ready for the CPA.

**Not** a budgeting app. **Not** a full accounting replacement. Works **with** QuickBooks.

---

## Operator model

- **Today:** Alex classifies expenses
- **Tomorrow:** Claudia learns and shares the load
- **Always:** Human-in-the-loop — AI suggests, human confirms. Never silently changes books.

---

## What's already built (this repo)

| Item | Status |
|------|--------|
| GitHub repo | https://github.com/ciutrust/hundie-cursor (ciutrust account) |
| Supabase project | **Hundie Project** — ref `ihciuqpiavxhbulfkwod`, org **ciutrust's Org**, region us-west-2 |
| Database | `entities` table seeded with 10 entities |
| Local verify | `npm run verify:db` — confirmed working |
| Docs | `docs/entities.md`, `docs/SUPABASE.md` |

### Entity registry (seeded in Supabase)

**Active / classifiable (5):**

| Name | Slug |
|------|------|
| GBSL, LLC | `gbsl` |
| Keller Services LLC | `keller` |
| Austin ACAA House LLC | `acaa-austin` |
| Personal | `personal` |
| Pflugerville Rental | `pflugerville` |

**Dormant — registry only, not classifiable (3):**

| Name | Slug | Notes |
|------|------|-------|
| Dallas ACAA House LLC | `dallas-acaa` | Not operational |
| Jiu Jitsu Coppell LLC | `jiu-jitsu-coppell` | Not operational; Coppell expenses → GBSL for now |
| ACAA Management LLC | `acaa-management` | Holding; not operational |

**Trusts — registry only (2):**

| Name | Slug |
|------|------|
| Three Cities Trust | `three-cities-trust` |
| Ciunciusky Spendthrift Trust | `spendthrift-trust` |

Future: entity detail page with EIN, addresses, compliance info from local tracker files (never commit EINs to git).

---

## Legal / property context (from uploaded CSVs)

### LLCs (Entity Master)

- **GBSL, LLC** — Alex 100% — operates GB Southlake + GB Coppell
- **Keller Services LLC** — Claudia 100% — JRoots Academy + TatamiCRM
- **Austin ACAA House LLC** — Alex 100% — owns 136 Anita, Keller TX (rental)
- **Dallas ACAA House LLC** — exists, dormant
- **Jiu Jitsu Coppell LLC** — formed May 2025, dormant (Coppell still under GBSL operationally)
- **ACAA Management LLC** — holding company, dormant
- **Three Cities Trust**, **Ciunciusky Spendthrift Trust** — Form 1041

### Real estate

| Property | Owner | Notes |
|----------|-------|-------|
| 512 Winding Ridge, Southlake | Alex (personal) | Primary residence |
| 124 Joshua Tree, Pflugerville | Alex (personal) | Rental — Schedule E |
| 136 Anita, Keller | Austin ACAA House LLC | Rental; **GBSL pays lease** → intercompany |

### Intercompany (v1: manual, v2: automate)

```
GBSL, LLC  ──(lease payment)──►  Austin ACAA House LLC
                                      └── 136 Anita rental income
```

Must not double-count. Flag manually in v1.

---

## Card inventory (14 accounts)

Each card needs: display name, issuer parser type, default entity, date rules, mixed-use flag.

| Card | Default entity | Notes |
|------|----------------|-------|
| WF Personal | Personal | |
| WF GBSL — Alex | GBSL | |
| WF GBSL — Claudia | GBSL | |
| WF GBSL Business Line | GBSL | |
| WF Keller Services | Keller Services | |
| Cap One Alex Platinum | Personal | |
| Cap One Claudia Quicksilver | GBSL → Personal | **Entity changes July 1** (GBSL through June, Personal from July) |
| Cap One Austin ACAA Green | Austin ACAA House | Anita property |
| Amex Alex Personal | Personal | |
| Citi AAdvantage Alex | Personal | |
| United Chase Claudia | Personal | |
| Citi Strata Claudia | Personal | |
| Citibank Home Depot | *None* | Mixed business + personal; 0% financing |
| Citibank Best Buy | *None* | Mixed business + personal; 0% financing |

**0% financing (Home Depot, Best Buy):** Treat charges as normal purchases with entity + category unless CPA says otherwise. Installment plan is payment arrangement, not separate expense.

---

## Bank accounts (Phase 2 — after cards)

| Account | Likely entity |
|---------|---------------|
| WF Personal Checking | Personal |
| WF Personal Savings | Personal |
| WF Anita | Austin ACAA House |
| WF GBSL | GBSL |
| WF Keller Services | Keller Services |
| WF Keller Services #2 (JRoots) | Keller Services |

Bank transactions harder than cards (transfers, intercompany). Cards first.

---

## MVP scope (locked decisions)

### Phase 1 — Now

1. **Card CSV import** — Jan–Jun 2026 backfill (hybrid: CSV now, Plaid later)
2. **Monthly review UI** — entity summary → drill-down → transaction detail
3. **Assign entity + category** on each charge
4. **Reclassify** — changes update all reports live
5. **Time views:** weekly, monthly, quarterly, yearly (monthly first for catch-up)
6. **Reports:** expense total per entity; click entity → explore that period's expenses; click expense → see source account + transactions

### Phase 2 — Training

7. **QuickBooks read (GBSL only for now)** — import categories + historical categorized expenses
8. **Progressive AI learning:** Jan classifications train Feb suggestions; Feb+Jan train March; etc.
9. QB history bootstraps suggestions; **Hundie ledger is source of truth** for card review

### Phase 3 — Later

10. Bank account CSV import + weekly AI review loop
11. QuickBooks write-back (when trusted)
12. Splits, intercompany automation, bills/due dates, income/P&L, year-end CPA packet

### Explicitly out of MVP v1

- Plaid live sync (CSV first)
- Keller QBO (no access yet — Hundie categories still work)
- QB write-back
- Splits
- Full intercompany automation

---

## Data architecture principles

1. **Ledger-first** — all data stored in Supabase; CSV files are import input only, never source of truth
2. **Reports computed from ledger** — reclassification updates all roll-ups immediately
3. **Deduplication** — hash on `(account_id, date, amount, description)` or issuer transaction ID
4. **Reclassification audit trail** — update current classification; append history
5. **RLS on all tables** — Supabase best practice

### Planned tables (not all built yet)

```
entities          ✅ done
accounts          — cards + bank accounts (defaults, date rules)
categories        — QB-aligned chart for GBSL
transactions      — one row per charge
classifications   — entity_id, category_id (current truth)
classification_history
import_batches
raw_import_rows   — audit only
qb_training_expenses — QB import for AI training (separate from card ledger)
category_mappings — Hundie category ↔ QB account per company
```

### Category model

- **Align to QuickBooks chart of accounts** for GBSL
- Unified Hundie category tree in UI with mappings to each QB company where names differ
- Personal / rental entities get Hundie-native categories mapping to Schedule E lines
- Keep nested QB names (`Cost of Goods Sold:School Wear`, `Legal & Professional Fees:Accounting Fees`)
- **Non-expense categories** — transfers, refunds, reclassify staging; excluded from expense totals via `lib/category-expense.ts` (see [CLASSIFICATION.md](./CLASSIFICATION.md))
- **GBSL Hundie-only non-expense:** `Credit card payment`, `Refund / credit` (checking-side payments are not QB expense categories)

---

## QuickBooks — GBSL export analysis

**File:** `Quickbooks-GBSL-Nov2022-June2026.csv` (user's Downloads)

| | |
|---|---|
| Report | Transaction Detail by Account |
| Company | Gracie Barra Southlake (GBSL) |
| Period | Nov 1, 2022 → Jun 25, 2026 |
| Accounting method | **Cash** |
| Rows | ~12,860 |

### Columns (header on row 5)

| Col | Field |
|-----|-------|
| 1 | Account section (e.g. `Capital One`, `Visa 0577`) |
| 2 | Transaction date |
| 3 | Transaction type |
| 4 | Num |
| 5 | Name (vendor) |
| 6 | Description |
| 7 | **Split (QB category)** |
| 8 | Amount |
| 9 | Balance |

### Import rules

**Include:** `Expense`, `Credit Card Expense`, maybe `Check`

**Skip:** Deposits, Journal Entries, Credit Card Payments, rows where Split is an account name (transfer), not a category

**Filter Split values** that match the ~66 account section names (e.g. `Navigate Business Checking`, `Visa 0577`, `Capital One` when used as transfer targets)

### Transaction counts

- Expense: 7,396
- Credit Card Expense: 282
- ~47 real expense categories after filtering
- Jan–Jun 2026: ~785 expense-type rows

### Top GBSL expense categories

Meals & Entertainment, Contract Labor, Merchant Fees, Cost of Goods Sold, Cost of Goods Sold:School Wear, Advertising & Marketing, Utilities, Travel, Office Supplies, Rent Expense, Franchise Fees, Repairs & Maintenance, Phone & Internet, Software, Dues & Subscriptions, Insurance, Legal & Professional Fees (nested), Tournament Fees, Events/Supplies, etc.

### QB card account sections → Hundie cards

| QB section | Likely Hundie account |
|------------|----------------------|
| Capital One | Cap One GBSL-related cards |
| Claudia's WF Business 1576 | WF GBSL — Claudia |
| Visa 0577 | Older WF/Visa business card |

### How QB data is used

```
QB CSV → qb_training_expenses + categories table
Card CSV → transactions table (source of truth)
AI suggestions = QB training + confirmed ledger + suggestion events + amount buckets (vendor key)
```

See [CLASSIFICATION.md](./CLASSIFICATION.md) for suggestion sources and [PHASE3_PLAN.md](./PHASE3_PLAN.md) for amount-aware rules.

QB export does **not** replace card CSV import. Different jobs.

### QBO access

- **GBSL only** for now (QuickBooks Online) — user has access
- Keller Services QBO — later
- API read planned after CSV bootstrap works; write-back much later

---

## Report & navigation UX (target)

```
Time view (Week / Month / Quarter / Year)
  → Entity summary (GBSL $X, Keller $Y, Personal $Z, Unclassified $N)
    → Click entity → expense explorer (by category + transaction list)
      → Click transaction → detail (source account, raw description, classification)
        → Reclassify (entity + category) → ledger updates → all views refresh
```

---

## Tech stack

| Layer | Choice |
|-------|--------|
| Repo | GitHub `ciutrust/hundie-cursor` |
| Database | Supabase (Postgres) — project ref `ihciuqpiavxhbulfkwod` |
| Auth | Supabase Auth (Alex now, Claudia later) |
| RLS | All ledger tables: **authenticated-only SELECT** (anon locked out since `20260629140000`) — see [SUPABASE.md](./SUPABASE.md) |
| App | Next.js (shipped — `/review`, `/reports`) |
| Bank sync (later) | Plaid |
| AI suggestions | QB training + confirmed ledger + amount buckets; pgvector possible later |

### Env vars (local, gitignored)

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- Service role key server-side only — never commit

---

## Build order (recommended)

1. ✅ Supabase project + entities seed
2. ✅ GitHub repo
3. **Next:** `categories` + `qb_training_expenses` tables + QB CSV import parser
4. `accounts` table + seed 14 cards with defaults/date rules
5. Card CSV import (issuer parsers: WF, Cap One, Amex, Citi, Chase)
6. Monthly entity summary + drill-down UI
7. Reclassify flow
8. Time grain toggle (monthly first)
9. AI suggestion engine v0 (vendor match against QB training)
10. Bank CSV import
11. QBO API read
12. QBO write-back

---

## Open questions (CPA / later)

- Tax treatment per entity — Schedule C vs E vs 1065 for LLCs
- Intercompany recording detail (GBSL → Anita lease)
- How far QB write-back should go and when to trust it
- Tax-category granularity — full IRS lines vs simplified CPA mapping
- Product vs just-for-me — decide after it earns its keep

---

## Source files (local, do not commit)

- `Entity_Tracker - Entity Master.csv`
- `Entity_Tracker - Compliance Tracker.csv`
- `Ciunciusky Asset Inventory Spreadsheet - *.csv`
- `Quickbooks-GBSL-Nov2022-June2026.csv`
- Card CSVs Jan–Jun 2026 (to be collected)

---

## Principles (do not violate)

- Not a budgeting tool
- Human-in-the-loop always
- Ledger is source of truth, not files
- Feeds accounting, doesn't replace it
- Dormant entities in registry but not in classification picker
- EINs and secrets never in git

---

## Suggested first message to agent in project window

> Read `docs/PROJECT_CONTEXT.md` and `docs/entities.md`. Next task: implement QuickBooks GBSL CSV import — create `categories` and `qb_training_expenses` tables, build parser for the QBO Transaction Detail by Account format, and import from the user's QB export file.
