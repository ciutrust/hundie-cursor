# Stage 2 Runbook — Reset & Clean Rebuild (hand-off doc)

> **For a fresh agent + operator (Alex).** Stage 1 is done on branch `stage1-overnight-fixes` (8 commits,
> all gates green). This runbook is self-contained — you do NOT need the Stage-1 build history. Read this,
> the migration file headers, and `~/.claude/plans/abstract-painting-quilt.md` for full context.

## What this does
Stage 1 fixed the import pipeline (no more double-count / lost transactions) and authored **21 additive
migration files** (not yet applied). Stage 2 **resets the transactional data and re-imports it cleanly**
through the fixed pipeline: CSV for history through **May 2026**, **Plaid for June** (a real monthly-sync
dry-run), with a clean cutover. Then you **classify once** on clean data.

## ⛔ Cardinal rules
- **This is destructive on a LIVE financial DB. Back up first (Phase 1) and verify the backup before any wipe.**
- It's reversible from the Phase-1 backup until Phase 7 verification passes.
- Single user (Alex) → no availability concern, but the data is real and tax-relevant. Dry-run every import.
- **KEEP tables are never wiped**: `entities`, `categories`, `accounts`, `date_rules`, `bank_connections`,
  `plaid_account_links`, `qb_training_expenses`. Only transactional tables are truncated (Phase 4).

---

## Phase 0 — Migration apply path (RESOLVE FIRST; operator + agent)
Stage 1 could not apply migrations (no `supabase` CLI on PATH; the app's service-role key is PostgREST-only;
the Supabase MCP returns permission-denied). Pick ONE apply path before doing anything else:

- **Option A (recommended): Supabase CLI.** `npm i -g supabase` (or `brew install supabase/tap/supabase`),
  then `supabase login`, `supabase link --project-ref ihciuqpiavxhbulfkwod`, and apply with `supabase db push`
  (applies the unapplied migrations in `supabase/migrations/` in timestamp order). Confirm with
  `supabase migration list`.
- **Option B: Dashboard SQL editor.** Paste each new migration's SQL in order (Phase 3 list) — tedious but
  needs no local setup.
- **Option C: Direct `pg`.** Get the project's connection string (Dashboard → Settings → Database) into
  `.env.local` as `DATABASE_URL`, then a small `node` runner using the `pg` devDependency applies each file.

Sanity check the connection: `npm run verify:db` (uses the service-role key) should list entities.

---

## Phase 1 — Backup (operator; do NOT skip)
1. **Full dump:** `supabase db dump --db-url <conn> -f stage2-backup-$(date +%Y%m%d).sql` (or `pg_dump`).
2. **Belt-and-suspenders JSON export** of the to-be-wiped tables via the service-role client (`@supabase/supabase-js`,
   `.select()` only): `transactions`, `classifications`, `classification_history`, `raw_import_rows`,
   `import_batches`, `ai_suggestions`, `suggestion_events`. (Ask the agent to write `scripts/export-ledger-backup.mjs`.)
3. **Verify** the dump restores into a scratch DB or at least that row counts match live. Keep the backup until Phase 7 passes.

## Phase 2 — Snapshot the training signal (BEFORE the wipe)
The high-confidence one-click suggestions are computed live from `classifications`; a wipe destroys them
(and cascade-wipes `suggestion_events`). Preserve them so re-classification is fast:
- Agent writes `scripts/snapshot-training.mjs`: `SELECT transactions ⋈ classifications (category_id NOT NULL)`
  joined to `categories`/`accounts`, `INSERT` into `qb_training_expenses`-shaped rows for **all entities**
  (carry entity_id, category_id, category_name=full_path, vendor_name, description, amount, transaction_date,
  source_account, transaction_type='hundie_snapshot', import_hash). `qb_training_expenses` is a KEEP table → survives.
- **Record baselines** for Phase 7: per-account `count` + `min/max(transaction_date)` per source, total classified count, per-entity totals.

## Phase 3 — Apply the 21 new migrations (in timestamp order)
They are additive and idempotent. Apply via the Phase-0 path. Order (auto by filename):
- **WS-A:** `20260703120000_add_transactions_external_id`, `…140000_add_transactions_plaid_removed_at`,
  `…141000_bank_connections_sync_from_date_not_null`
- **WS-E:** `20260704120000_mortgage_interest_principal_split` … `124000_meals_entertainment_split`,
  `125000_chart_tidy`, `190000_categories_kind_column`
- **WS-F:** `20260705120000_tax_line_form_mapping` … `126000_personal_charitable_sch_a`
- **WS-G:** `20260706120000_create_payees`, `…121000_create_fixed_assets`, `…122000_create_account_reconciliations`,
  `…123000_create_sales_tax_periods`

> The WS-E rent/vehicle sub-account migrations resolve `parent_id` from QB-imported categories
> (`Rent Expense`, `Ford Motor Credit - F150`). On the **live** DB these already exist (categories are a KEEP
> table), so `parent_id` resolves. If you ever rebuild on a fresh DB, run the QB import (Phase 5.3) first.
> After applying, optionally `npm run gen:types` (now writes `lib/types/database.generated.ts`) to refresh types.

## Phase 4 — The reset (destructive; only after Phases 1–3)
```sql
TRUNCATE transactions, classifications, classification_history,
         ai_suggestions, suggestion_events, raw_import_rows, import_batches
  RESTART IDENTITY CASCADE;

UPDATE bank_connections SET sync_cursor = NULL;   -- else the June re-sync returns nothing
```

## Phase 5 — Re-import (dry-run each first)
1. **2025 history:** the `2025-WF-*` CSVs live in the `CSV 2025-2026` subdir but `import:2025` resolves at
   `~/Downloads` root — **move/copy them there first**. Then `npm run import:2025` (bare = dry-run) → inspect → `npm run import:2025:apply`.
   Plus `npm run import:sheet` (dry-run) / `import:sheet:apply` (the 2025 xlsx for the 6 non-WF cards).
2. **QB training re-import:** `npm run import:qb-gbsl` and `npm run import:qb-keller` (idempotent via `unique(entity_id, import_hash)`).
3. **2026 Jan–May CSV — cap at May 31.** ⚠️ **Known gap:** `import:cards:csv-2025-2026` has **no date ceiling**
   (the importer consolidation was deferred from WS-A), so it would write June rows too. Before running, EITHER
   (a) trim the 2026 CSVs to ≤ 2026-05-31, OR (b) have the agent add a `--to 2026-06-01` flag to
   `scripts/import-cards.mjs` (port `inDateRange`/`dateTo` from `scripts/lib/ledger-import.mjs`). Then
   `import:cards:csv-2025-2026` (bare = dry-run) → inspect → `import:cards:csv-2025-2026:apply`.
4. **Cutover config:** `UPDATE bank_connections SET sync_from_date = '2026-06-01';` (the exchange route never
   sets it; default is today). With CSV capped at May 31, this is a clean seam (gate is inclusive-lower / exclusive-upper).
5. **Plaid June sync (no re-link):** run the sync for each connection — the default 90-day window covers June, so
   no Plaid re-auth needed. `sync_from_date` drops everything `< 2026-06-01`, so only June-onward lands.

## Phase 6 — Classify once, on clean data
Everything re-imports as `category_id = NULL` (entity from account default). Re-classify in the `/review` UI —
the engine pre-fills suggestions from the Phase-2 snapshot + QB training (one-click confirm; bulk-reclassify
vendor clusters). Apply the overnight findings as you go (from the gitignored `docs/overnight/2026-06-27/00-FINDINGS-TRACKER.md`):
book income to income categories, split rental mortgage principal/interest, reclass the GBSL Google Ads off
personal cards, the $40k NEXXESS review, the 2025 classification sprint (Keller first).

> **Engine note:** if Personal/Keller suggestions are weak, the engine may still gate qb_training to GBSL only —
> generalize `lib/actions/suggestions.ts` (drop the `entitySlug === "gbsl"` gate + feed snapshot amounts into the
> amount-bucket ranker) so the snapshot powers one-click suggestions for all entities. (Was scoped for Stage 2.)

## Phase 7 — Verify & reconcile (vs the Phase-2 baseline)
- **Counts:** per-account count + min/max date — expect **equal or higher** (recovered BUG-03 duplicates),
  never silently lower; investigate any drop.
- **No dupes:** the data-integrity business-key cluster query returns 0 cross-source clusters; the DATA-01
  $10k transfer / overlap rows are gone.
- **Signs:** expense-kind+negative and income-kind+positive anomaly queries ≈ 0.
- **Cutover:** no charge appears from both a May CSV and a June Plaid pull; **reconcile Plaid-June against the
  June CSV** (kept as ground truth) — if Plaid June is materially incomplete (history-window / auth-vs-posted),
  fall back to importing the June CSV.
- **Reports agree:** `/review` and `/reports` show the same operating-expense total for an entity+period.
- **Build/tests:** `npm run build` green; `npm test` green.

## Rollback
Until Phase 7 passes, restore the wiped tables from the Phase-1 backup (KEEP tables were never touched).
Snapshot rows in `qb_training_expenses` (`transaction_type='hundie_snapshot'`) are additive and harmless if rolled back.

---

## Appendix — state at hand-off
- Branch: `stage1-overnight-fixes` (8 commits ahead of `main`; review with `git diff main..stage1-overnight-fixes`).
- Gates: build ✓, typecheck ✓, lint ✓ (0 err), 204 tests ✓.
- Findings detail (real $ figures, gitignored): `docs/overnight/2026-06-27/00-FINDINGS-TRACKER.md` + `00-MORNING-BRIEFING.md`.
- Stage 3 (after clean data): the report UIs (1099-NEC, Form 4562, reconciliation, CPA packet) — schema foundations already in place (WS-G tables).
- Decisions locked: full scope (2025+2026), keep-only-the-training, hybrid source / no Plaid re-link.
