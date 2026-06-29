# Hundie — Overnight Deep Review (orchestrator prompt)

> Paste the **"PASTE BELOW"** block into Claude Code from the repo root, in a fresh session, before you go to bed.
> It runs seven independent review passes and leaves you a ranked morning briefing.
> Read the "How to run it" section at the very bottom first — model choice + the one command matter.

---

## What this does

Seven self-contained passes, each writing its own dated report to `docs/overnight/`:

1. **Code review + optimization** (propose-only)
2. **Security review**
3. **Data integrity** — duplicates, transaction signs, CSV-vs-Plaid reconciliation
4. **System QA**
5. **Bug hunt**
6. **Accountant's critique** (acts as a CPA)
7. **Tax expert's critique** (acts as a tax advisor; missing categories, personal + business)

Then a final **synthesis pass** reads all seven and writes the ranked morning briefing.

## The rules that keep this safe to run unsupervised on a live financial app

These are the most important lines in this document. The agent must obey them in every pass.

- **PROPOSE-ONLY. Do not modify application code, schema, or data.** No edits to `app/`, `lib/`, `components/`, `supabase/migrations/`, no `apply_migration`, no writes to any table. Every fix, optimization, or correction is written into a report as a diff or a numbered recommendation for Alex to apply while awake. The **only** files you may create are the reports under `docs/overnight/` (and `docs/overnight/` is gitignored — see setup).
- **All database access is READ-ONLY.** You may `SELECT` / run read queries against Supabase (via the Supabase MCP `execute_sql` or the read paths in `lib/queries/`) to gather evidence for the data, accountant, and tax passes. You may **never** `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, or run DDL. If a finding requires a data fix, write the corrective SQL into the report as a proposal, clearly marked "DO NOT RUN UNREVIEWED."
- **Never run the existing mutating scripts.** `scripts/cleanup-ledger-duplicates.mjs`, `scripts/import-*.mjs`, `scripts/apply-qb-categories-to-ledger.mjs --apply`, etc. write data. Do **not** execute them. You may **read** them to understand logic, and you may run their `--dry-run` / `--verify` variants only if you can confirm from the source that the flag performs no writes.
- **Stay on the current branch; do not commit, push, or merge.** Leave git history untouched. Reports are uncommitted working files.
- **Each pass is independent.** Do not let one pass's failure stop the others. If a pass can't complete (missing access, an error), write what you found, note the blocker at the top of that pass's report, and move on to the next pass.
- **Evidence over assertion.** Every finding cites a `file:line` or a query + its result. No vague "consider improving error handling." If you can't back a claim with evidence from the actual repo or a real query result, don't make it.

## Before you start — orient, then set up output

1. Read these to load current design intent and reality (the repo has evolved — trust the code over any single doc):
   `docs/PROJECT_CONTEXT.md`, `docs/CLASSIFICATION.md`, `docs/Roadmap.md`, `docs/Backlog.md`, `docs/INCOME_CAPTURE_PLAN.md`, `docs/security/ciunciusky-trust-information-security.md`, `README.md`, `RUN.md`.
2. Skim the schema surface: every file in `supabase/migrations/` (note especially `20260702120000_create_bank_connections.sql`, `20260702130000_create_plaid_account_links.sql`, `20260625140000_create_accounts_and_transactions.sql`, `20260629140000_lock_anon_select_to_authenticated.sql`, `20260630120000_create_ai_suggestions.sql`).
3. Skim the data/query layer: `lib/queries/*.ts` (especially `reconcile.ts`, `review.ts`, `reports.ts`, `income.ts`, `intercompany.ts`), `lib/category-expense.ts`, `lib/category-review.ts`, and the Plaid routes under `app/api/plaid/*`.
4. List the helper scripts so you reuse rather than reinvent: `scripts/cleanup-ledger-duplicates.mjs`, `scripts/audit-orphan-classifications.mjs`, `scripts/verify-*.mjs`.
5. Create the output folder `docs/overnight/<YYYY-MM-DD>/`. **`docs/overnight/` is NOT currently gitignored — add the line `docs/overnight/` to `.gitignore` as your very first write, before creating any report**, because these reports will contain real financial detail (named entities, dollar amounts, transaction specifics) and must never be committed. Verify the entry is in `.gitignore`, then proceed.

## Execution model — three phases (this run uses ultracode / parallel subagents)

This run is launched in **ultracode** mode, so you may and should **fan the passes out into parallel subagents**. But parallelism has two hazards on a shared output folder and a synthesis that depends on everything else, so structure the run in **three strict phases with barriers between them:**

### Phase A — SETUP (serial, must finish before anything else starts)
Do this yourself, once, before launching any pass:
1. Create `docs/overnight/<today>/`.
2. **Add `docs/overnight/` to `.gitignore` and verify it's there.** No pass may write a report containing real numbers until this line exists — so it must happen in Phase A, not concurrently.
3. Do the "Before you start" orientation reading (load the design intent + schema surface) once, so the shared context is established before subagents spawn.
This phase is a barrier: **no Phase-B pass may begin until Phase A is fully complete.**

### Phase B — THE SEVEN PASSES (run in parallel)
Passes 1–7 are **independent**: each reads the codebase/DB read-only and writes exactly one report file. There are no write conflicts between them (each owns a distinct filename). **Launch them as parallel subagents.** Each subagent:
- Receives its complete brief from the sections below (the briefs are self-contained — a subagent does not need the others' output).
- **Independently inherits every safety rule:** propose-only (modify no code/schema/data), read-only DB access, never run mutating scripts, never commit. A parallel subagent that "forgets" it can't write is the main risk of this mode — each one must re-confirm these rules at its start.
- Writes only its own report:
  1. Security → `01-security.md`
  2. Data integrity (CSV vs Plaid, dupes, signs) → `02-data-integrity.md`
  3. Bug hunt → `03-bugs.md`
  4. System QA → `04-qa.md`
  5. Code review + optimization → `05-code-optimization.md`
  6. Accountant critique → `06-accountant.md`
  7. Tax expert critique → `07-tax.md`
- If a subagent fails or is blocked, it writes what it found with the blocker noted at the top of its report and exits. **One pass failing must not abort the others or the run.**

**Concurrency note on the database:** several passes (2, 6, 7) query the real ledger simultaneously. All access is read-only `SELECT`s, so concurrent reads are safe. Do **not** have any subagent open a transaction, hold a lock, or attempt a write.

This phase is a barrier: **the synthesis (Phase C) may not begin until all seven reports exist** (a report that records a blocker still counts as "exists" — synthesis notes it as blocked).

### Phase C — SYNTHESIS (serial, after all seven complete)
Once all seven report files are present, run the synthesis: read all seven, then write `00-MORNING-BRIEFING.md` and `00-FINDINGS-TRACKER.md` as specified below. This is single-threaded — it depends on the full set.

> If for any reason ultracode/parallel execution is unavailable, fall back to running the seven passes **sequentially in the numbered order** (security and data first, so the highest-stakes findings exist even if a late pass dies), then synthesis. The phase barriers (setup first, synthesis last) apply either way.

---

## Output the synthesis pass must produce (read after all 7 are done)

**`00-MORNING-BRIEFING.md`** — the doc Alex reads first. Structure:

1. **🚨 CRITICAL — read before doing anything.** Anything that (a) exposes data, (b) corrupts the books / a tax return, or (c) loses transactions. Each with one-line impact + which report has detail. If there are none, say so explicitly.
2. **Run summary** — which of the 7 passes completed, which were blocked, and why.
3. **Top 15 findings, ranked across all passes**, each: severity (Critical/High/Medium/Low), one-line description, the pass it came from, rough effort (S/M/L), and the single highest-leverage action first.
4. **The accountant's headline** — the 3 most important things the CPA-pass said, in plain language.
5. **The tax expert's headline** — the 3 most important things, including the single most important missing category on each of the personal and business sides.
6. **What I'd do first this week** — a short ordered list.

**`00-FINDINGS-TRACKER.md`** — a single table of *every* finding from all passes: `| ID | Pass | Severity | Finding | Evidence (file:line / query) | Proposed fix | Effort | Status (open) |`. This is Alex's checklist.

**Severity definitions (use consistently):**
- **Critical** — data exposure, books/tax-return corruption, or transaction loss. Wake-up-worthy.
- **High** — wrong numbers in a report, a real bug a user will hit, a security weakness short of exposure.
- **Medium** — correctness risk under specific conditions, meaningful tech debt, maintainability.
- **Low** — polish, style, nice-to-have.

---

# ════════════════════════════════════════
# PASTE BELOW — this is the actual prompt for Claude Code
# ════════════════════════════════════════

You are running an unsupervised overnight deep-review of **Hundie**, a live multi-entity financial ledger (Next.js App Router + Supabase Postgres) that imports bank/card data via **CSV backfill and live Plaid sync**, classifies every transaction to an entity + tax category (human-in-the-loop), and produces CPA-ready reports. It holds real financial data for multiple LLCs, two rental properties (Schedule E), a personal household, and trusts (Form 1041). It is deployed on Vercel.

Your job tonight: run the seven review passes specified in `PROMPT-OVERNIGHT-review.md` (this file), obeying the safety rules in that file **without exception**. The cardinal rules: **propose-only — modify no code, no schema, no data; all DB access is read-only; do not run mutating scripts; do not commit or push.** Every finding must cite evidence (`file:line` or a query and its result).

**Run it in three phases (see "Execution model" above), using parallel subagents since this is an ultracode session:**
1. **Phase A — Setup (serial):** create `docs/overnight/<today>/`, add `docs/overnight/` to `.gitignore` and verify it, do the orientation reading. Finish this entirely before launching any pass.
2. **Phase B — The seven passes (parallel):** launch passes 1–7 as concurrent subagents. They are independent and each writes one report file. **Every subagent must re-confirm the cardinal safety rules at its start** — propose-only, read-only DB, no mutating scripts, no commits. If a pass fails or is blocked, it records the blocker in its report and exits; one failure never aborts the others.
3. **Phase C — Synthesis (serial):** once all seven reports exist, read them all and write `00-MORNING-BRIEFING.md` + `00-FINDINGS-TRACKER.md` exactly as specified.

Begin with Phase A now.

# ════════════════════════════════════════
# THE SEVEN PASS BRIEFS (Claude Code reads the whole file)
# ════════════════════════════════════════

> Shared facts every pass should assume (verified against the repo — confirm, don't re-derive):
> - **Sign convention is load-bearing.** Ledger sign = **positive is an outflow/charge/expense; negative is money-in (refund, deposit, income).** Confirmed in `lib/category-kind.ts` (income lands negative), `lib/category-expense.ts` (`isExpenseAmount` = `amount > 0`), and `lib/plaid/ledger-filter.ts`. Any pass touching amounts must use this convention, not assume "expenses are negative."
> - **Category kind drives every rollup.** `lib/category-kind.ts` classifies each category path as `expense | income | transfer | funding | capital`. Only `expense` (with positive amount) hits expense totals. Transfers/funding/capital are excluded from P&L. This is the source of truth — `lib/category-expense.ts` re-exports it.
> - **Plaid reuses the CSV write path verbatim.** `lib/plaid/run-sync.ts` calls `buildImportPlanFromTransactions` + `importAccountPlan` from `scripts/lib/ledger-import.mjs`. So both import sources share one dedup + classification pipeline.
> - **Two different dedup keys exist** (`scripts/lib/import-hash.mjs`): `buildTransactionHash` (the `UNIQUE(account_id, import_hash)` constraint) **includes `issuerReference`**; `buildTransactionDedupeKey` (the pre-insert business-key filter) does **not**. This distinction is central to the data pass.
> - **Plaid dupe guard** is `sync_from_date` on `bank_connections` (CSV covers history, Plaid takes over after the cutover). Read the comments in `20260702120000_create_bank_connections.sql`.

---

## PASS 1 — SECURITY REVIEW → `01-security.md`

Hundie holds real multi-entity financials and is on Vercel. Assess the security posture with evidence. The obvious anon-RLS hole was already fixed (`20260629140000_lock_anon_select_to_authenticated.sql`) — **verify it's airtight rather than re-reporting it**, then look wider.

Check, with `file:line` evidence:
1. **RLS coverage on every table.** Walk all `supabase/migrations/*.sql`. Confirm each table has RLS enabled and intended policies. Pay special attention to the Plaid tables (`bank_connections`, `plaid_account_links`) which are deliberately **deny-all** (service-role only) — confirm no policy accidentally grants anon/authenticated access, and that no client-side code path tries to read them with the publishable key.
2. **Secret handling.** `lib/crypto/secret-box` (AES-256-GCM for Plaid tokens), the encryption key's provenance (env only?), `lib/supabase/service-role.ts` usage — is the service-role client ever imported into a client component or a route that isn't auth-gated? Grep for it.
3. **Plaid route auth.** Every route under `app/api/plaid/*` — is each one auth-gated (`supabase.auth.getUser()`), and where is MFA step-up (`lib/plaid/require-mfa`) enforced vs. missing? `sync/route.ts` has it; check link-token, exchange, reconnect, map-accounts, disconnect.
4. **Injection / query construction.** The `.or()` ILIKE filters in `lib/actions/suggestions.ts` and anywhere user input reaches a query — is `escapeIlikePattern` applied everywhere? Any raw SQL string interpolation in scripts?
5. **Secrets in git.** Confirm `.env*` is gitignored and no key/token is committed (scan tracked files, not just current state).
6. **Dependency + header posture (lightweight).** Note any obviously outdated security-sensitive dep or missing security header in `next.config.ts`/`middleware.ts` — don't go deep, just flag.

Output: findings table (severity, file:line, why it matters, proposed fix as a recommendation — **do not edit**). Lead with anything Critical.

---

## PASS 2 — DATA INTEGRITY: DUPLICATES, SIGNS, CSV↔PLAID → `02-data-integrity.md`

**This is the highest-value pass. All queries are READ-ONLY `SELECT`s.** Reuse the existing tooling as a starting point — read `scripts/cleanup-ledger-duplicates.mjs` and `scripts/audit-orphan-classifications.mjs` to see what's already checked (do **not** run the cleanup script; it writes). Extend with the checks below.

### 2a. Duplicate transactions — and specifically the CSV-vs-Plaid seam
The dedup design has a known seam you must probe directly. The `UNIQUE(account_id, import_hash)` constraint hashes in `issuerReference` (Plaid `transaction_id` for Plaid rows; different/absent for CSV rows). So **the same real charge imported once from CSV and once from Plaid produces two different `import_hash` values and the UNIQUE constraint will NOT catch it.** The only things preventing that duplicate are (a) the `sync_from_date` cutover and (b) the `buildTransactionDedupeKey` business-key filter (`account_id|date|amount|normalized-description`), which only runs over the incoming batch's date window.

Run queries to find:
- **Business-key duplicates that slipped the UNIQUE constraint:** group `transactions` by `(account_id, transaction_date, round(amount,2), lower(normalized description))` having `count(*) > 1`. These are the real-world dupes. For each cluster, show the rows, their `import_hash`es, and which `import_batches.source_type` they came from (`card_csv` vs `plaid_sync`) — a cluster spanning both sources is the smoking gun.
- **Cutover correctness:** for each `bank_connections` row, find its `sync_from_date`, then check whether any `plaid_sync` transaction exists for that account *before* the cutover (should be none) and whether there's a CSV/Plaid overlap window around the boundary.
- **Near-duplicates:** same account + amount + description within ±3 days (catches date-shift between a CSV "transaction date" and Plaid "posted date").
- Quantify: how many suspected dupe clusters, total dollar impact, which entities/accounts affected. **Propose** the corrective SQL (marked DO NOT RUN UNREVIEWED) — never execute it.

### 2b. Transaction signs — are income/expense/refund signs correct?
Using the convention (positive = outflow/expense, negative = money-in), find sign anomalies:
- Transactions classified to an **expense** category (`categoryKind = expense`) with a **negative** amount → either a mis-sign or a misclassified refund. List them.
- Transactions classified to an **income** category (`categoryKind = income`) with a **positive** amount → income should be a negative inflow. List them.
- **Refund/credit** category rows with positive amounts, and any credit-card account rows Plaid tagged INCOME that leaked past `shouldImportPlaidTxn` (the Citi Strata case in `ledger-filter.ts`).
- Card vs depository expectations: on credit-card accounts, charges should be positive; large negatives that aren't refunds/payments are suspect. On checking/savings, deposits (negative) are now kept (income capture) — confirm they're landing uncategorized, not silently in expense.
- Cross-check against `categoryKind`: does every transaction's sign agree with its category's kind? Tabulate the mismatches.

### 2c. Completeness — did we miss or mis-route data?
- **Orphans:** transactions with no `classifications` row (run the logic of `audit-orphan-classifications.mjs` read-only), and classifications pointing to a missing transaction or category.
- **Unmapped Plaid accounts:** any `plaid_account_links` gap where a connected account's transactions are silently dropped (`run-sync.ts` skips unmapped accounts — quantify what's being skipped).
- **Removed-but-kept:** `run-sync.ts` intentionally does not delete Plaid `removed` transactions (they may carry a human classification). Surface any transactions that Plaid has since removed but remain in the ledger — these need human review.
- **Date/entity routing:** spot-check the `date_rules` entity switches (e.g. the Quicksilver GBSL→Personal cutover, see `20260630140000_quicksilver_re_resolve_to_gbsl.sql`) actually routed correctly around the boundary date.
- **Account coverage:** list every account and its min/max transaction date + count, per source type, so gaps (a month missing for one card) are visible.

Output: each sub-section with the query used, the result (counts + sample rows), severity, and a proposed (not executed) remediation. A summary table at top: total dupe clusters, sign anomalies, orphans, with dollar impact.

---

## PASS 3 — BUG HUNT → `03-bugs.md`

Hunt for real defects, not style. Read the actual logic and reason about failure modes. Prioritize bugs that produce **wrong numbers or lost data** over cosmetic ones.

Focus areas (cite file:line, describe the trigger, give a repro or the exact input that breaks it):
- **Import/dedup edge cases** in `scripts/lib/ledger-import.mjs` and `import-hash.mjs`: what happens with a `null`/empty description, an amount that rounds oddly, a missing `issuerReference`, a re-sync after a partial failure (the self-heal path at lines ~342-385 — does it actually self-heal in all branches?).
- **Plaid sync** (`lib/plaid/run-sync.ts`): cursor handling on partial failure, the `added`+`modified` merge, pending→posted settling, multi-account batching, the `sync_from_date` null case.
- **Suggestion engine** (`lib/suggestions/*`, `lib/actions/suggestions.ts`): division by zero / empty-array handling in the ranking math, the amount-bucket logic, NaN from `Number()` coercion.
- **Expense/category rollups** (`lib/category-kind.ts`, `lib/queries/reports.ts`, `report-analytics.ts`, `reconcile.ts`, `income.ts`, `intercompany.ts`): any path where a transfer/funding/capital row could leak into an expense total, or a category-path string mismatch (trailing space, casing) silently misclassifies kind.
- **Server actions** (`lib/actions/*`): error swallowing into `{ error }` that the UI never surfaces; missing auth checks; `revalidatePath` gaps that leave stale totals after a reclassify.
- **Date/timezone**: `transaction_date` (date) vs `posted_date` vs `created_at` (timestamptz) — any off-by-one from UTC vs local, especially around month boundaries (which drive the whole monthly review).

Output: ranked bug list with severity, trigger, evidence, and proposed fix (not applied).

---

## PASS 4 — SYSTEM QA → `04-qa.md`

A structured quality pass over the running system as a product.

1. **Build + typecheck + lint:** run `npm run build`, `npx tsc --noEmit` (or the project's typecheck), `npm run lint`. Report failures and warnings verbatim. Run the existing `verify:*` scripts that are read-only (`verify:db`, `verify:card-parsers`, `verify:qb-parser`) and report results.
2. **Test coverage reality:** test coverage is minimal — there is at least one test (`lib/plaid/ledger-filter.test.ts`), so a test runner is already wired; confirm how it runs and whether it passes. Then identify the 6–8 highest-value *untested* pure functions to cover next (the ranking functions in `lib/suggestions/*`, `categoryKind`, `buildTransactionHash`/`buildTransactionDedupeKey`, the sign helpers) and write the *test plan* (cases + expected) using the existing test setup as the pattern — write the plan, not the tests.
3. **Critical user journeys — trace the code paths** (don't click; read the routes/actions and confirm they hold together): sign-in → review a month → reclassify single + bulk → totals refresh; import a CSV; connect a bank + map accounts + sync; generate a report / CSV export; the AI-suggestion accept/reject loop. For each, note where it could break or where error states are unhandled.
4. **Data-display correctness:** do the numbers shown in `/review`, entity pages, the monthly matrix, and `/reports` reconcile with each other and with the ledger? Flag any place two screens could show different totals for the same period (e.g. expense-exclusion applied in one query but not another).
5. **Accessibility + empty/error states (light):** missing loading/empty/error states on the main screens; obvious a11y gaps. Keep brief.

Output: a QA report with a pass/fail per journey, the build/lint output, and the prioritized test plan.

---

## PASS 5 — CODE REVIEW + OPTIMIZATION (PROPOSE-ONLY) → `05-code-optimization.md`

Senior review for performance, correctness, and maintainability. **Propose every change as a diff or recommendation — modify nothing.**

- **Query performance:** N+1 patterns in `lib/queries/*` and server actions; missing indexes (cross-check against `20260701130000_perf_indexes.sql` — what's still unindexed that a hot query filters/sorts on?); the 1000-row Supabase pagination handling (the import path pages correctly — do the report queries?); over-fetching columns.
- **Suggestion engine:** the hand-tuned weights and repeated full-table scans for matches — propose a cleaner/faster structure without changing behavior, and flag where behavior *would* change.
- **Duplication:** repeated query shapes across `lib/queries/`, the several overlapping import scripts in `scripts/` (many one-off SQL generators) — identify what's dead and archivable vs. canonical.
- **Type safety:** is `lib/types/database.ts` generated from the DB or hand-maintained and drifting? The `as unknown as` casts in `run-sync.ts` — can they be removed with generated types?
- **Maintainability:** the largest/most complex files; anything Claudia (future second operator) or a new dev would struggle to follow.

Rank proposals by (impact ÷ effort). Top of the report = the few that are clearly worth doing. Each with a concrete before/after sketch.

---

## PASS 6 — ACCOUNTANT'S CRITIQUE (act as a CPA) → `06-accountant.md`

Adopt the perspective of a CPA who does books for small multi-entity owners (LLCs, rentals, an S-corp or two). You have **read-only access to the real ledger** — query it for evidence and cite real numbers. Be candid and critical; Alex wants the hard truths.

Cover:
1. **Is the bookkeeping approach sound?** Critique the expense-first model with income/funding/capital as "additive lenses" (`lib/category-kind.ts`). Does that hold up for real double-entry-adjacent books, or will it create reconciliation pain? Is cash-basis (as the QB export implies) the right call per entity?
2. **Chart of accounts quality:** review the actual categories per entity. Are GBSL's QB-aligned categories complete and correctly mapped? Are the rental (Schedule E) and Personal charts sensible? Where are categories too coarse or too granular for clean books?
3. **The things that corrupt small-business books** — check the data for: owner draws/contributions miscoded as expense or income; credit-card payments leaking into P&L; **intercompany** handling (GBSL pays the 136 Anita lease → Austin ACAA; see `lib/queries/intercompany.ts`) — is double-counting actually prevented, and is the lease recorded correctly on both sides?; transfers between own accounts inflating activity; sales tax handling (`Sales Tax Payable` is a transfer kind — correct?); loan/HELOC principal vs interest split (`20260701120000_mortgage_heloc_payment_categories.sql`).
4. **Reconciliation discipline:** is there a real path to tie each account to statements? (`lib/queries/reconcile.ts` reconciles to QBO — assess it.)
5. **Reports a CPA actually wants** — list the reports Hundie should generate for clean books and a smooth year-end, with a one-line purpose each: e.g. P&L per entity (cash + accrual), Balance Sheet basics, General Ledger detail, Transaction Detail by Account, owner equity/draws roll-forward, intercompany due-to/due-from, uncategorized/AMA aging, 1099-vendor contractor totals (Contract Labor → who crosses $600), sales-tax liability, month-over-month and YoY expense trends. Mark which already exist vs. are missing.

Output: a candid memo — what's right, what's risky, what to change, and the prioritized report list (exists / missing).

---

## PASS 7 — TAX EXPERT'S CRITIQUE (act as a tax advisor) → `07-tax.md`

Adopt the perspective of a tax advisor (EA/CPA) for someone with multiple LLCs, two rentals (Schedule E), a personal return, and trusts (Form 1041). **Read-only access to real data — cite specifics.** This pass exists to make April painless and to catch missed deductions; be thorough and critical.

Cover:
1. **Critique the tax approach** baked into Hundie's categories and entity model. Does the category→tax-line mapping actually map to the right forms? GBSL (Schedule C vs 1065/1120-S — which, and do the categories fit?), rentals → Schedule E line items, Personal → Schedule A / above-the-line, trusts → 1041. Where will the current categories force manual rework at tax time?
2. **Entity/return mapping:** confirm each active entity has a clear filing destination and that mixed-use cards (the Home Depot/Best Buy 0%-financing, mixed business/personal cards) are being split or flagged correctly. Flag anything that risks commingling that the IRS would dislike.
3. **MISSING CATEGORIES — this is a priority deliverable. Produce two explicit lists:**
   - **Business side — tax categories likely missing or mis-scoped**, e.g.: Section 179 / bonus depreciation & a fixed-asset/depreciation schedule (capital is tracked but is there a depreciation path?), business vehicle/mileage vs actual, home-office, business meals (50% vs 100% post-rule), Qualified Business Income considerations, startup/organizational costs, health insurance (S-corp owner), retirement plan contributions (SEP/Solo-401k), state franchise/margin tax (TX), 1099 contractor tracking, R&D/software capitalization, bad debt, business gifts ($25 limit). For each: why it matters and which entities it applies to.
   - **Personal side — tax categories likely missing or mis-scoped**, e.g.: HSA contributions, 529 contributions, charitable (cash vs non-cash, with substantiation), medical above the AGI floor, SALT components (already present — verify completeness), mortgage interest split (primary vs the rentals — make sure rental interest isn't on Schedule A), investment income/expense, child tax credit / dependent care, estimated-tax payments tracking, energy-efficiency / EV credits, gambling, tax-prep fees. For each: why it matters.
4. **Deduction leakage check:** query the data for expenses currently sitting in generic/uncategorized/AMA buckets that are probably deductible but unclassified — quantify the potential missed deductions by entity.
5. **Tax reports Hundie should generate** — list them with purpose: per-entity tax-line summary mapped to the actual form/schedule, Schedule E worksheet per property, Schedule C/1065 expense summary per business, 1099-NEC contractor report, estimated-tax basis (YTD net by entity), capital-asset/depreciation schedule, charitable-contribution log, mileage log, a year-end "CPA packet" per entity. Mark exists vs. missing.

Output: a candid tax memo, the two missing-category lists (business + personal) front and center, the leakage estimate, and the prioritized tax-report list (exists / missing).

# ════════════════════════════════════════
# END OF PASS BRIEFS
# ════════════════════════════════════════

---

# How to run it (read this part yourself, Alex — not the agent)

## Which model

Short version: **run the whole thing on Opus.** This is long-horizon, high-stakes, multi-domain reasoning (security + data forensics + accountant + tax) — exactly where the strongest model earns its cost, and you're not babysitting it to course-correct. The usual "Sonnet for daily coding, Opus for the hard parts" advice is about *interactive* work where you can switch mid-task. Overnight, unattended, you want the ceiling the whole way.

- In Claude Code, set it before you paste the prompt: type `/model opus` (uses the latest Opus — currently Opus 4.6). 
- If you have access to **Fable 5** and don't mind the cost, it's the top tier for exactly this kind of long, complex, autonomous run — its lead grows the longer the task. For a once-in-a-while overnight audit of your finances, that's a defensible splurge. Opus is the sensible default; Fable is the "spare no expense" option.
- Do **not** run this on Sonnet/Haiku to save money — the data-integrity and tax passes are where a cheaper model quietly misses things, and missing things is the whole risk.

Either way, confirm the model with `/model` (no args shows current) before you start.

## The actual run — two good options

**Option A — interactive, left running (simplest):**
1. Open Terminal, `cd` into the repo.
2. Launch Claude Code, then `/model opus`.
3. Paste the **"PASTE BELOW"** block (the agent reads the rest of this file itself — it's referenced by name).
4. Approve the initial tool permissions, then leave it. Make sure your machine won't sleep: on macOS run the session under `caffeinate -i` (e.g. start Claude Code from a terminal you launched with `caffeinate -i -s`), or set Energy Saver to never sleep on power. A sleeping laptop is the #1 reason overnight runs don't finish.

**Option B — headless / unattended (most reliable for overnight):**
Run it non-interactively so it can't stall on a prompt and so output is logged:
```bash
cd /path/to/hundie-cursor
mkdir -p docs/overnight            # tee can't create the dir itself — make it first
caffeinate -i claude -p "$(cat PROMPT-OVERNIGHT-review.md)" \
  --model opus \
  --permission-mode acceptEdits \
  2>&1 | tee docs/overnight/run-log-$(date +%Y%m%d).txt
```
(Do NOT add `--dangerously-skip-permissions` — it's a boolean flag with no `=value`, and you want permissions ON for an unsupervised run on real finances. `acceptEdits` is enough: it lets the agent write its report files without prompting, and the prompt itself is propose-only.)
Notes on the flags:
- `caffeinate -i` keeps the Mac awake while the command runs.
- `--model opus` pins the model.
- **Permissions vs. the propose-only rule:** the prompt itself forbids writing anything except reports under `docs/overnight/`. Because it's read-only by design, you can run with normal permissions; the reports are the only writes. If your Claude Code version supports an allow-list, restrict writes to `docs/overnight/**` and allow the read tools + Supabase MCP `execute_sql` (which you must keep read-only — see below). Do **not** grant it the ability to run arbitrary scripts unsupervised.
- `tee` keeps a full log so if a pass dies you can see where.

## One safety setup that matters: keep the DB read-only

The data/accountant/tax passes query your real ledger. Make sure the Supabase access available to Claude Code tonight **cannot write**:
- Best: point the Supabase MCP (or the connection it uses) at a **read-only Postgres role**, or use a **read replica / branch**. Then "read-only" is enforced by the database, not just by the prompt.
- The prompt already forbids writes, mutating scripts, and migrations — but defense-in-depth means making writes *impossible*, not just *disallowed*. For a financial app, do this.

## Before you go to bed — 60-second checklist
1. `git status` is clean and you're on a branch you're fine leaving untouched (the run won't commit, but start clean so the morning diff = just the reports).
2. `docs/overnight/` is gitignored (the prompt has the agent confirm this, but check — the reports will contain real numbers).
3. `npm run build` passes *now* (so a build failure in the QA pass is a real finding, not a pre-existing mess).
4. Model is Opus (`/model`).
5. Machine won't sleep (`caffeinate` or Energy Saver).
6. The DB credentials in play are read-only (above).

## In the morning
Open `docs/overnight/<date>/00-MORNING-BRIEFING.md` first — it leads with anything Critical and ranks the top 15. Then `00-FINDINGS-TRACKER.md` is your checklist. The seven detailed reports are there when you want the evidence behind a finding. The accountant and tax memos (`06`, `07`) are the ones to read with coffee, not skim — that's where the real money and the missed deductions are.

## Realistic expectations
- This is a big run; expect a few hours and meaningful token spend on Opus. That's appropriate for a once-in-a-while deep audit of real finances — not something to run daily.
- It will find some false positives (especially in the data pass — a "duplicate" may be two legitimately identical small charges). That's why every finding cites evidence and proposes rather than acts. You're the judge in the morning.
- If you want this to become routine, the *cheap* recurring version is just Pass 2 (data integrity) on Sonnet weekly, with the full seven-pass Opus run quarterly or before tax filing.
