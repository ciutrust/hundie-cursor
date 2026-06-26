# Changelog

All notable changes to the Hundie project. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Planned

- Refund import policy (C2) — credits/refunds dropped at parse time
- Archive dead MCP scripts to `scripts/archive/`
- Git history scrub for `.qb-import-batches.json` (removed from tracking in 0.2.0)
- Keller QBO import
- Manual intercompany flag (GBSL → Anita lease)
- Remaining card accounts (Home Depot, Best Buy, etc.)

---

## [0.2.0] — 2026-06-26

**Shipped on `main`** (merge `Phase-1-review-2026-06-26`, commit `1baf5c1`). Migrations below are in the repo **and applied** to Supabase project `ihciuqpiavxhbulfkwod` unless noted.

### Security

- **RLS lockdown** — `20260629140000_lock_anon_select_to_authenticated.sql`; anon can no longer SELECT ledger tables; authenticated-only read ([SUPABASE.md](./SUPABASE.md))
- **Auth defense in depth** — middleware covers `/review`, `/reports`, `/settings`; server actions require authenticated user; safe post-login redirect

### Added

- **Senior engineering review** — [REVIEW-2026-06-26.md](./REVIEW-2026-06-26.md) (review-only doc; fixes implemented separately)
- **Vitest** — `npm test`; unit tests for category-expense, entity resolver, import hash, CSV escape, period fallback, blend ranking
- **CSV reconcile columns** — `counts_as_expense` + `expense_amount` on report exports; formula-injection hardening
- **`gen:types` script** — regenerate `lib/types/database.ts` from Supabase
- **Quicksilver date rule** — GBSL through 2026-06-30; `20260630140000` re-resolves mis-booked classifications ([QUICKSILVER-DATE-RULE.md](./QUICKSILVER-DATE-RULE.md))
- **AI pre-classifier** — Anthropic batch classify for Personal uncategorized; `20260630120000_create_ai_suggestions.sql`; Ask AI panel; `/reports/ai-suggestions` ([AI-PRECLASSIFY.md](./AI-PRECLASSIFY.md))
- **UI polish** — app shell sidebar, dark mode, review dashboard KPI strip, entity cards, spending trends
- **`app/error.tsx`** — global error boundary for failed server actions

### Changed

- **`import_hash`** — issuer reference or CSV row index to avoid dropping same-day duplicate charges
- **Suggestion chips** — `count` reflects real match occurrences, not blended score weight
- **Review entity totals** — exclude backlog rows from per-entity sums (C8)
- **Personal card report** — `grandTotal` filters with `isOperatingExpense`
- **Invalid period URLs** — fall back to current month instead of hard-coded `2026-06`
- **`.qb-import-batches.json`** — removed from git tracking (added to `.gitignore`; local copy OK)
- **`npm run verify:db`** — prefers `SUPABASE_SERVICE_ROLE_KEY` (anon returns empty after RLS lockdown)

### Documentation

- [AI-PRECLASSIFY.md](./AI-PRECLASSIFY.md), [QUICKSILVER-DATE-RULE.md](./QUICKSILVER-DATE-RULE.md)
- Backlog, SUPABASE.md, RUN.md updated for shipped status

---

## [0.1.1] — 2026-06-29

Phase 3 classification UX and learning (already on `main` before 0.2.0).

### Added

- **Amount-aware suggestions** — `rankAmountAwareMatches`, blend ranking, chip UX; `npm run verify:amount-aware`
- **Unclassified & AMA filter** — toggle on transaction list
- **Non-expense category logic** — `lib/category-expense.ts`; transfers/refunds excluded from expense totals
- **GBSL transfer categories** — `Credit card payment`, `Refund / credit` (`20260629120000`)
- **Rental categories** — Bank fees, CC interest, tenant meals (`20260629120000`)
- **Personal category** — `Credit card interest (non-deductible)`
- [CLASSIFICATION.md](./CLASSIFICATION.md) — operator + agent guide

### Changed

- Entity expense totals use `isOperatingExpense()`
- Suggestion pipeline passes transaction `amount` + `vendorKey` for amount-aware ranking

---

## [0.1.0] — 2026-06-26 (Phase 1)

### Added

- **Project planning doc** — `docs/PROJECT_CONTEXT.md`
- **Entity registry** — 10 entities (5 classifiable)
- **QB-aligned schema** — `categories`, `qb_training_expenses` (~3,577 GBSL training rows)
- **Card ledger schema** — `accounts`, `transactions`, `classifications`, `raw_import_rows`
- **Card CSV parsers** — Wells Fargo, Chase, Amex, Citi, Capital One
- **Card import pipeline** — `import:cards`, dry-run, verify, SQL batch generation
- **Phase 1 review UI** — Supabase Auth, entity summary, drill-down, reclassify, bulk assign
- **Phase 2 suggestions** — QB training + confirmed ledger blend; `suggestion_events` table
- **Reports** — `/reports` entity summary + CSV export
- **Initial backfill** — ~1,882 transactions, Jan–Jun 2026, 17 accounts

---

## [0.0.1] — 2026-06-25

Initial repository setup — GitHub repo, Supabase project, entities migration, verify scripts.

[Unreleased]: https://github.com/ciutrust/hundie-cursor/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/ciutrust/hundie-cursor/compare/v0.1.0...v0.2.0
[0.1.1]: https://github.com/ciutrust/hundie-cursor/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/ciutrust/hundie-cursor/compare/v0.0.1...v0.1.0
[0.0.1]: https://github.com/ciutrust/hundie-cursor/releases/tag/v0.0.1
