# Changelog

All notable changes to the Hundie project. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Security

- **RLS lockdown** — migration `20260629140000_lock_anon_select_to_authenticated.sql`; anon can no longer SELECT ledger tables; authenticated-only read (see [SUPABASE.md](./SUPABASE.md))

### Added

- **Amount-aware suggestions (Phase 3.3)** — re-rank by vendor + amount bucket; `lib/suggestions/amount-aware-ranking.ts`; source `amount_match`; UI badge on chips; `npm run verify:amount-aware`
- **Unclassified & AMA filter** — toggle next to Select all; `reviewBacklogOnly` in `lib/transaction-filters.ts`
- **Non-expense category logic** — `lib/category-expense.ts`; transfers/refunds excluded from entity expense totals
- **GBSL transfer categories** — `Credit card payment`, `Refund / credit` (migration `20260629120000`)
- **Rental categories** — `Bank fees`, `Interest expense (credit card)`, `Meals & entertainment (rental)` (ACAA + Pflugerville)
- **Personal category** — `Credit card interest (non-deductible)`
- **Classification guide** — [docs/CLASSIFICATION.md](./CLASSIFICATION.md)
- **Phase 1 review UI** — `/review` with Supabase Auth, entity summary, drill-down, single + bulk reclassify
- **Search & filters** — text, amount operators, category/account multiselect
- **Classification audit** — `classification_history` + RLS writes
- **Phase 2 suggestions** — QB training + confirmed ledger blend; `suggestion_events` table
- **Personal + rental category charts** — migrations `20260626120000`, `20260627120000`
- **Keller Services data** — 4 WF accounts; 152 transactions; parent/child CC dedupe
- **Reports** — `/reports` entity summary + CSV export (partial)

### Changed

- `npm run verify:db` prefers `SUPABASE_SERVICE_ROLE_KEY` (anon returns empty after RLS lockdown)
- Entity expense totals use `isOperatingExpense()` — credit card payments no longer inflate spend numbers
- Suggestion pipeline passes transaction `amount` + `vendorKey` for amount-aware ranking
- Ledger ~1,882 transactions across 17 accounts

### Documentation

- [CLASSIFICATION.md](./CLASSIFICATION.md) — operator + agent reference (categories, transfers, suggestions)
- [PHASE3_PLAN.md](./PHASE3_PLAN.md) — amount-aware rules marked shipped
- Updated Roadmap, Backlog, RUN.md, PROJECT_CONTEXT.md, OVERNIGHT_HANDOFF.md

### Not yet built

- Keller QBO import
- Manual intercompany flag (GBSL → Anita lease)
- Remaining card accounts (Home Depot, Best Buy, etc.)
- Reports CSV export polish

---

## [0.1.0] — 2026-06-26 (Phase 1)

### Added

- **Project planning doc** — `docs/PROJECT_CONTEXT.md`
- **Entity registry** — 10 entities (5 classifiable)
- **QB-aligned schema** — `categories`, `qb_training_expenses` (~3,577 GBSL training rows)
- **Card ledger schema** — `accounts`, `transactions`, `classifications`, `raw_import_rows`
- **Card CSV parsers** — Wells Fargo, Chase, Amex, Citi, Capital One
- **Card import pipeline** — `import:cards`, dry-run, verify, SQL batch generation
- **Initial backfill** — 1,730 transactions, Jan–Jun 2026, 13 accounts

---

## [0.0.1] — 2026-06-25

Initial repository setup — GitHub repo, Supabase project, entities migration, verify scripts.

[Unreleased]: https://github.com/ciutrust/hundie-cursor/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ciutrust/hundie-cursor/compare/v0.0.1...v0.1.0
[0.0.1]: https://github.com/ciutrust/hundie-cursor/releases/tag/v0.0.1
