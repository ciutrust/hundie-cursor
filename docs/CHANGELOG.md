# Changelog

All notable changes to the Hundie project. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Planned

- Git history scrub for `.qb-import-batches.json` (removed from tracking in 0.2.0; still in history — needs `git filter-repo`/BFG + force-push)
- Enable Supabase leaked-password protection (Auth setting)
- Make card import atomic (txn + classification in one RPC) so partial failures can't orphan rows (C5 prevention; audit script covers existing orphans)
- Keller QBO import
- Remaining card accounts (Home Depot, Best Buy, etc.)
- Refactor the `blend-ranking.ts` source ternary for legibility; net refunds in report totals (currently gross — refunds visible but not auto-netted)
- AI Review backlog: server-side vendor grouping / pagination (the page loads ~2,845 uncategorized Personal rows client-side today)

---

## [0.3.0] — 2026-06-26

Productivity + expense-control features (commits `37ee55f`..`4e1b60e`). Suite: 39 tests / 12 files green; adversarially QA'd before push (no regressions).

> Hundie is an **expense-control** tool, not the books — categorization is for managing spend by entity; the tax treatment (mortgage principal/interest split, deductions) happens in **QuickBooks Online**.

### Added

- **AI Review — inline assign + override** (`/review/ai`) — each vendor-group line now has an editable **Entity** + **Category** (prefilled from the AI suggestion) and an **Assign** button. Assign applies to the **selected** rows (all by default; uncheck to exclude). Keeping the AI pick logs an `accept`; overriding saves *your* category and logs a `reject` of the AI's original. An override still trains the deterministic engine — via confirmed history **and** a new reject-credits-chosen rule in `blend-ranking.ts`. Replaces the all-or-nothing "Accept AI". (D)
- **Find similar → bulk categorize** — a **"Find similar"** button on each review-list row narrows to the same vendor (vendor-key match, the same logic suggestions use) and selects them all for the existing bulk **Assign**; a "Similar:" chip clears it. (A)
- **Mortgage payment / HELOC payment categories** — single-payment, **counted** expense categories on Pflugerville, Austin ACAA, Personal (the whole payment, no principal/interest split — the split happens in QBO). Migration `20260701120000`; seeded live. (B)

### Changed

- **Performance** (C) — the review dashboard recomputed `getEntitySummaries` twice (page + inside `getReviewDashboardStats`); the latter now returns its summaries so the page reuses them (~40% fewer period loads on the busiest page). Folded the serial `getCpaReviewCategoryIdSet` round-trip into the `Promise.all` of `getEntitySummaries` + `getReviewDashboardStats`. Added `transactions(transaction_date)` and `classifications(entity_id, category_id)` indexes (migration `20260701130000`).

### Docs

- `CLASSIFICATION.md`: refund import behavior (C2) + mortgage/HELOC categories + Find-similar / AI-assign workflows.

---

## [0.2.2] — 2026-06-26

Review follow-ups (issues 1–8 from the [REVIEW](./REVIEW-2026-06-26.md) status ledger). Suite: 35 tests / 11 files green.

### Added

- **Accept-rate by source** — `acceptanceBySource()` (pure, tested) + `getSuggestionAcceptanceBySource()`; a table on `/reports/ai-suggestions` comparing the LLM (`ai_llm`) vs the deterministic engine sources, so weight-tuning is data-driven (#6)
- **Intercompany review** — `/reports/intercompany` surfaces GBSL ↔ Austin ACAA (136 Anita) lease legs and flags same-date/`|amount|` cross-entity pairs as possible double-counts, with a "verify manually" banner; `flagIntercompanyMatches` pure + tested (C10)
- **Orphan-classification audit** — `scripts/audit-orphan-classifications.mjs` reports (and `--apply` heals) transactions with no classification row, which the inner-join queries would otherwise hide (C5). Live: 0 orphans today
- **Tests** — parser refund handling, amount-aware ranking, accept-rate tally, intercompany flagging (+13 tests)

### Changed

- **Refunds/credits now imported as negative transactions** across all five parsers (C2) — they enter the ledger, are classifiable as `Refund / credit`, show in the CSV (`counts_as_expense=no`), and stay out of `amount>0` expense totals; card payments still dropped; checking deposits still dropped (income out of scope). **Re-import card CSVs to backfill historical refunds.** Totals remain gross (CPA nets via the visible refund rows)
- **~45 dead one-off `mcp-*`/`run-*`/`exec-*` backfill scripts** removed from tracking (local copies in the gitignored `scripts/archive/`); `scripts/` 65 → 18 (#5)

### Verified

- **Live RLS** — anon SELECT on `transactions`/`classifications`/`categories`/`accounts` returns `[]` on `ihciuqpiavxhbulfkwod` (the previously-unverifiable production check — confirmed locked out) (#8)

---

## [0.2.1] — 2026-06-26

Reports section restructure, two `/reports` crash fixes, and error-boundary diagnostics (post-0.2.0, on `main` through `dd07baa`).

### Added

- **Reports IA** — dedicated report pages (transaction detail; spending-by-entity / spending-by-category matrices; category breakdown; top vendors; uncategorized aging; classification progress; account summary; year-over-year; GBSL reconcile; business-expenses-on-personal-cards; funding; AI-suggestion stats), entity-nav sidebar, AI review page, vendor-group AI
- **AI review panel** — select / unselect-all controls; large runs chunked into batched server actions to avoid timeouts; run cost-confirmation dialog
- **Error-boundary diagnostics** — `app/error.tsx` gains a collapsible **"Log entry"** that surfaces the error digest, name, message, and stack with a copy button (full trace in dev; digest → server logs in prod, by Next.js design)

### Fixed

- **`/reports` crash (server/client boundary)** — `parseReportPeriod` / `parseReportEntitySlug` were exported from the `"use client"` `report-filters` module but called from Server Components, throwing *"Attempted to call X from the server but X is on the client"* on every report page. Moved both pure helpers to a server-safe `lib/reports/report-params.ts`; repointed all 10 report pages (`fd2d291`)
- **`/reports` shell queries** — lightweight shell queries on the reports hub to avoid timeout/crash (`5e9f3cc`)
- **Theme hydration** flash on first paint

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

[Unreleased]: https://github.com/ciutrust/hundie-cursor/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/ciutrust/hundie-cursor/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/ciutrust/hundie-cursor/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/ciutrust/hundie-cursor/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/ciutrust/hundie-cursor/compare/v0.1.0...v0.2.0
[0.1.1]: https://github.com/ciutrust/hundie-cursor/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/ciutrust/hundie-cursor/compare/v0.0.1...v0.1.0
[0.0.1]: https://github.com/ciutrust/hundie-cursor/releases/tag/v0.0.1
