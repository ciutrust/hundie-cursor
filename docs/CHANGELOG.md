# Changelog

All notable changes to the Hundie project. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### 2026-07-01 review — Track 1: correctness & architecture (C4–C21) — shipped 2026-07-03 (PR #10, merge `5acabb9`)

Closes the 17 open correctness/architecture findings from [REVIEW-2026-07-01.md](REVIEW-2026-07-01.md), across 6 TDD batches; each adversarially reviewed, and a whole-branch review additionally caught a C4 gap in `getIncomeSummary`.

**Fixed**

- **Reversed Plaid charges no longer count (C4).** `plaid_removed_at` rows are excluded from every report roll-up, the backlog count, month/tax close, and `/reports/income`.
- **Orphaned charges keep a month open (C9).** A transaction with no classification row now counts toward close/backlog (a separate `orphanCount`), so a month can't read "closed" with unbooked charges; an "Unassigned (no entity)" row surfaces orphans on entity-less accounts.
- **Stable proposal pagination (C10).** `getProposalsForEntity` + the generator page by a unique `id` tiebreaker, so >1000-row backlogs can't skip/duplicate rows.
- **Heterogeneous vendor-group approve (C13).** A mixed group (rows with different proposed categories/entities) can no longer be one-click approved into `proposals[0]`'s category **or entity** — approve keeps each row's own.
- **Proposal decision guards (C14).** `setProposalDecision` won't flip a committed/skipped proposal back to approved; it returns the real matched count.
- **Signed bulk suggestion amount (C15).** The bulk representative keeps its sign so refunds don't collapse into the charge bucket.
- **Override training signal (C16).** Committing an override logs a `reject` of the proposed category, not an `accept`, so the engine's accept-rate isn't inflated.
- **Entity date-rules require both bounds (C17).** A rule with `from` and `until` matches only inside the window (was matching on `until` alone).
- **Modified-then-ineligible Plaid rows (C20).** A `modified` event that becomes ledger-ineligible stamps the stale row removed instead of leaving it; a re-eligible row is un-stamped.
- **Wells Fargo parent/child merge one-for-one (C21).** N identical parent charges against one child no longer collapse to one.
- **CSV→Plaid cutover off-by-one (whole-branch review).** The CSV window cap meets the Plaid seam exactly (was dropping the day before the cutover).

**Changed**

- **Payment-name drop scoped to card accounts (C12).** Depository "ZELLE PAYMENT FROM …" rent income and "AUTO PAY" mortgage debits are now KEPT (income capture) — only card payments are dropped; each import logs a dropped-row summary. *Expect these rows to start appearing uncategorized on the next sync/import.*
- **Re-link / CSV overlap guards (C5, C6).** A backdated Plaid cutover that would re-import a synced window is refused (`force` to override); a CSV import into a Plaid-linked account is capped at that account's `sync_from_date` unless `--force`.
- **Intercompany mirror window (C19).** Mirror-leg detection widened from same-day to ±3 days (flag-only, for human review).
- **/categories kind + errors (C11).** QB-imported (kind-NULL) categories render under their true P&L kind, the page surfaces query errors, and QB imports stamp `kind` at upsert.

**Added**

- **Transaction audit trail (C8).** New `transaction_history` table + trigger records amount/date/description changes (audit-only, non-blocking), surfaced as a "changed since close" chip on Month/Tax Close. *Migration `20260708120000` applied to prod 2026-07-03.*
- *(C18 — `transaction_splits` sum-to-parent invariant intentionally deferred to the future splits-writer; doc note only, no code.)*

### Added

- **`cleanup:ledger-dupes`** — one-time script to remove duplicate ledger rows (same account, date, amount, description). Keeps oldest or categorized row; `--entity` / `--account` filters. Dry-run by default; `--apply` deletes.

### Changed

- **Destructive npm scripts now default to dry-run (T3).** Bare `npm run import:*` and `cleanup:ledger-dupes` no longer inject `--apply` — they preview only. Writes require the explicit `:apply` suffix (e.g. `import:cards:apply`, `cleanup:ledger-dupes:apply`); `:dry-run` aliases are kept for back-compat. `import-cards.mjs` `parseArgs` now defaults `dryRun: true` and gained an `--apply` flag plus an `isMain` guard so importing it (for tests) no longer runs the script.

### Fixed

- **Cleanup dedupe over-deletion (C7).** `cleanup:ledger-dupes` now keys duplicate groups on `import_hash` (falling back to the business key only for hash-less legacy rows) and excludes groups spanning distinct `external_id`s, so genuine same-day/same-amount charges and distinct Plaid transactions are preserved (BUG-03). Pagination now sorts on the stable unique `id` instead of the non-unique `transaction_date`.
- **Import dedupe** — `import_hash` no longer includes CSV row index (caused Keller WF accounts to double-count ~130 charges when the same export was imported twice). Imports now also skip rows that match existing ledger rows on business key, even under legacy hashes. In-file dedupe before insert.

### Planned

- Git history scrub for `.qb-import-batches.json` (removed from tracking in 0.2.0; still in history — needs `git filter-repo`/BFG + force-push)
- Enable Supabase leaked-password protection (Auth setting)
- Make card import atomic (txn + classification in one RPC) so partial failures can't orphan rows (C5 prevention; audit script covers existing orphans)
- Keller QBO import
- Remaining card accounts (Home Depot, Best Buy, etc.)
- Refactor the `blend-ranking.ts` source ternary for legibility; net refunds in report totals (currently gross — refunds visible but not auto-netted)
- AI Review backlog: server-side vendor grouping / pagination (the page loads ~2,845 uncategorized Personal rows client-side today)

---

## [0.4.0] — 2026-06-26

### Added

- **Month Close** (`/month-close`) — per-entity readiness for a single month. A month is *closed* when every entity with activity is at zero backlog (0 unclassified + 0 “Ask My Accountant”). Month picker; click an entity’s “N left” to drill into that entity-month’s backlog. Activates the previously-disabled “Month close” nav item.
- **Tax Close** (`/tax-close`) — year grid (entities × months) rolling each month’s close status up to a tax-close-ready year. Green ✓ = closed, amber count = rows still needing a category (click to clear), · = no activity. Year picker. New “Tax close” nav item under Tax readiness.
- Both routes are auto-computed from existing data (no new tables), share one `getMonthCloseMatrix(year)` query, and sit behind the auth middleware. Pure roll-up logic in `lib/month-close.ts` with 9 unit tests (48 total).

Readiness means “is this period fully categorized for hand-off” — an expense-control milestone, not a tax calculation (the split stays in QBO).

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
