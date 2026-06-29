# Stage 2 — Migration & Live-Schema Audit (findings of record)

> Captured 2026-06-29 at the start of Stage 2, against live Supabase project **`ihciuqpiavxhbulfkwod`** ("Hundie Project").
> This documents what we found before applying anything. Companion to `docs/STAGE2-RUNBOOK.md`.
> Evidence: read-only MCP queries + a 29-agent line-by-line audit of every unapplied migration vs. the live schema.

## TL;DR
- **Phase 0 (apply path) is solved a better way than the runbook assumed:** the re-authenticated Supabase **MCP** has full DDL privileges (`execute_sql` + `apply_migration`). No `supabase` CLI, no `DATABASE_URL`, no dashboard pasting. (Verified with a create/alter/index/insert/drop probe that self-cleaned — neither `pg_dump` nor the `supabase` CLI is installed locally, so MCP is the path.)
- **All 28 unapplied migrations are safe to apply to the live DB in filename order — zero error-level blockers.** The "additive & idempotent" claim holds (verified down to em-dash/arrow bytes).
- **The migration history is unreliable** — the live schema is *ahead* of it; we verified against the actual schema, not `list_migrations`.

## Live-schema reconciliation (why the history can't be trusted)
- `supabase_migrations` records **15** migrations (all dated 2026-06-25/26). The disk has **43** migration files.
- The 15 recorded versions have **different timestamps** than the matching disk filenames (e.g. DB `20260625055422_create_entities` vs disk `20260625000000_create_entities`). A version-tracking tool (`supabase db push`) would see *zero* matches and try to re-run all 43.
- **Tables exist that aren't in history:** `bank_connections` (7 rows) and `plaid_account_links` (17 rows) are live but unrecorded → they were applied out-of-band. So "what's applied" must be read from the **actual schema**, which we snapshotted.
- Net: the real unapplied gap is **28 files (disk #16–#43), not the 21** the runbook tracks. The extra 7 (dated 07-01/07-02) include the two Plaid tables (now no-ops) and several category seeds.

### Confirmed absent live (so genuinely new, clean to add)
Columns `transactions.external_id`, `transactions.plaid_removed_at`, `categories.kind`, `categories.tax_form`, `categories.tax_line`, `entities.return_type`; and tables `transaction_splits`, `self_rental_links`, `payees`(+`payee_aliases`), `fixed_assets`, `account_reconciliations`, `sales_tax_periods`.
(Note: the `…_tax_line_form_mapping` migration is a *column*-adder + backfill — it adds `categories.tax_form`/`tax_line`, it does NOT create a table.)

### Live cardinals (KEEP data that makes the migrations resolve)
10 entities (5 classifiable: gbsl, keller, acaa-austin, personal, pflugerville), 17 accounts, 171 categories, 7 healthy Plaid connections (all with cursors; `sync_from_date` 06-02…06-20), `qb_training_expenses` = 3832.

## The 28-file apply set (apply order = filename order; maps to disk files #16–#43)

| # | Migration file | Status vs live | Re-apply safety | Action |
|---|---|---|---|---|
| 1 | `20260701140000_keller_refund_category.sql` | already applied | safe_idempotent | apply_as_is |
| 2 | `20260702120000_create_bank_connections.sql` | already applied | safe_idempotent | apply_as_is |
| 3 | `20260702130000_create_plaid_account_links.sql` | already applied | safe_idempotent | apply_as_is |
| 4 | `20260702140000_hide_split_mortgage_categories.sql` | new | safe_idempotent | apply_as_is |
| 5 | `20260702150000_personal_legal_professional_category.sql` | already applied | safe_idempotent | apply_as_is |
| 6 | `20260702160000_income_funding_capital_categories.sql` | already applied | safe_noop | apply_as_is |
| 7 | `20260702170000_cash_back_category.sql` | already applied | safe_noop | apply_as_is |
| 8 | `20260703120000_add_transactions_external_id.sql` | new | safe_idempotent | apply_as_is |
| 9 | `20260703140000_add_transactions_plaid_removed_at.sql` | new | safe_idempotent | apply_as_is |
| 10 | `20260703141000_bank_connections_sync_from_date_not_null.sql` | partial | safe_idempotent | apply_as_is ⚠ P2 |
| 11 | `20260704120000_mortgage_interest_principal_split.sql` | partial | safe_idempotent | apply_as_is ⚠ P3 |
| 12 | `20260704121000_gbsl_vehicle_loan_split.sql` | new | safe_idempotent | apply_as_is ⚠ P5 |
| 13 | `20260704122000_gbsl_rent_expense_locations.sql` | new | safe_idempotent | apply_as_is ⚠ P5 |
| 14 | `20260704123000_intercompany_136_anita.sql` | new | safe_idempotent | apply_as_is |
| 15 | `20260704124000_meals_entertainment_split.sql` | new | safe_idempotent | apply_as_is |
| 16 | `20260704125000_chart_tidy.sql` | partial | safe_idempotent | apply_as_is |
| 17 | `20260704190000_categories_kind_column.sql` | new | safe_idempotent | apply_as_is ⭐ adds `kind` |
| 18 | `20260705120000_tax_line_form_mapping.sql` | new | risky_conflict | in-order only ⭐ adds `tax_form`/`tax_line`; needs #17 |
| 19 | `20260705121000_entities_return_type.sql` | new | safe_idempotent | apply_as_is |
| 20 | `20260705122000_transaction_splits.sql` | partial | safe_idempotent | apply_as_is |
| 21 | `20260705123000_self_rental_links.sql` | new | safe_idempotent | apply_as_is |
| 22 | `20260705124000_tx_franchise_margin_tax.sql` | new | risky_conflict | in-order only (needs #17) |
| 23 | `20260705125000_personal_tax_categories.sql` | new | risky_conflict | in-order only (needs #17,#18) |
| 24 | `20260705126000_personal_charitable_sch_a.sql` | new | risky_conflict | in-order only (needs #17,#18) |
| 25 | `20260706120000_create_payees.sql` | new | safe_idempotent | apply_as_is |
| 26 | `20260706121000_create_fixed_assets.sql` | new | safe_idempotent | apply_as_is |
| 27 | `20260706122000_create_account_reconciliations.sql` | new | safe_idempotent | apply_as_is |
| 28 | `20260706123000_create_sales_tax_periods.sql` | new | safe_idempotent | apply_as_is |

Distribution: 6 already-applied no-ops · 18 genuinely new · 4 "risky" (only if cherry-picked). Every category INSERT is conflict-guarded (`ON CONFLICT DO NOTHING` or `WHERE NOT EXISTS`).

## The 4 "risky_conflict" files are false alarms in isolation
Files #18, #22, #23, #24 reference `categories.kind` / `tax_form` / `tax_line` — columns **added earlier in the same batch** (#17 adds `kind`; #18 adds `tax_form`/`tax_line`). Each per-file agent judged them against *current* live (which lacks those columns) and flagged an abort. **In filename order the columns always exist before the consumers run**, so the whole set applies cleanly. The fix is simply: **apply in order, do not cherry-pick.**

## Watch-items (from the cross-file critic) — all benign for our chosen path
- **P1 — column chain:** `#17 → {#18,#22,#23,#24}` and `#18 → {#23,#24}`. Satisfied by filename order. Apply as one ordered batch.
- **P2 — #10 `sync_from_date NOT NULL`:** live rows are all non-null, so it succeeds, but it *freezes* current values (06-15/06-20/…). Harmless because **Phase 5.4 overwrites `sync_from_date='2026-06-01'`** before the Plaid pull.
- **P3 — #4 + #11 mortgage pair:** #4 over-broadly hides `Mortgage interest%` (incl. deductible rental/personal); #11 re-activates exactly those + adds personal `Mortgage principal — primary home`. **Net = no-op on `is_active` + 1 new category.** Both are in the batch → fine. Never apply #4 without #11.
- **P4 — #2/#3 Plaid tables:** confirmed safe no-ops (`CREATE TABLE IF NOT EXISTS` + idempotent `ENABLE RLS`); live columns match the definitions (no drift).
- **P5 — #12/#13 parent-id lookups:** resolve `parent_id` by name from **live QB categories** (`Ford Motor Credit - F150`, `Rent Expense`), both present → resolve correctly. (Would only orphan on a *fresh* DB; our reset keeps categories, so N/A.)
- **Cleared:** no DELETE/TRUNCATE/DROP TABLE/DROP COLUMN anywhere; the only mutations are reversible `is_active` toggles and `WHERE <col> IS NULL`-guarded backfills; no object created twice; `DROP POLICY IF EXISTS` only re-creates RLS on same-file tables.

## Recommended apply approach (Phase 3)
Apply all 28 **in filename order** via the MCP. Per-file `apply_migration` (records each in history → repairs the divergence going forward) is acceptable because the set is verified idempotent; a mid-batch failure is re-runnable. After applying, spot-verify:
- `select kind, count(*) from categories group by 1;` (no unexpected nulls/mis-kinds)
- `select count(*) from categories where parent_id is null and full_path like '%:%';` → expect 0 (catches orphaned split subaccounts)
- `select column_name from information_schema.columns where table_name='transactions' and column_name in ('external_id','plaid_removed_at');` → both present

## Phase 1 backup record (DONE & verified)
- `node scripts/export-ledger-backup.mjs` → `~/hundie-backups/stage2-2026-06-29_05-12-13/` (outside the repo; financial data).
- Full logical export of all 13 tables; integrity-checked twice (writer + independent on-disk parse). **28,498 wipe-table rows** + KEEP tables. Counts match live exactly. This fully reverses the Phase-4 wipe.

## ⛔ Critical Phase-4 fix (discovered during Phase-2 prep)
The runbook's Phase-4 statement `TRUNCATE … import_batches … RESTART IDENTITY CASCADE` is **unsafe as written**.
`qb_training_expenses` (a KEEP table, 3,832 rows — **all** with `import_batch_id` set) is the **only** external FK into the wipe set (`qb_training_expenses_import_batch_id_fkey → import_batches`). `TRUNCATE … CASCADE` truncates every table that references the set, so it would **wipe `qb_training_expenses` entirely** — destroying all training data + the Phase-2 snapshot.

**Required Phase-4 sequence:**
```sql
UPDATE qb_training_expenses SET import_batch_id = NULL;   -- remove the only external FK into the wipe set (recoverable from backup; those batches get wiped anyway)
TRUNCATE transactions, classifications, classification_history,
         ai_suggestions, suggestion_events, raw_import_rows, import_batches
  RESTART IDENTITY CASCADE;                                -- now CASCADE has nothing extra to pull in
UPDATE bank_connections SET sync_cursor = NULL;
```
Phase-2 snapshot rows are already inserted with `import_batch_id = NULL`, so they are immune regardless.

## Open items for later phases (not blocking Phase 3)
- **Merge/deploy ordering:** apply migrations (Phase 3) → merge `stage1-overnight-fixes` → `main` + deploy (so the live app & Plaid sync route run fixed code against the new schema) → *then* Phase 4 wipe & re-import. New code must not deploy before its schema exists.
- **Phase 5 known gaps (from runbook):** `import:2025` resolves CSVs at `~/Downloads` root (move the `2025-WF-*` files there); `import:cards:csv-2025-2026` has **no date ceiling** (trim 2026 CSVs to ≤ 2026-05-31 or add a `--to 2026-06-01` flag) so June isn't double-counted against the Plaid pull.
- **Plaid June sync trigger:** confirm whether the monthly sync runs via the deployed app route/cron (needs the deploy) vs. a local script.
- **Migration history not back-filled:** Phase 3 applied via a raw `pg` run (`scripts/stage2/apply-migrations.mjs`), which does NOT write `supabase_migrations.schema_migrations`. So `list_migrations` still shows only the original 15. Harmless today (nothing here uses `supabase db push`), but if the CLI is ever adopted, record the 28 versions first. Low priority.

## Execution log (what was actually done)
- **2026-06-29 — Phase 0:** apply path = Supabase MCP (read+DDL verified) + `pg` runner via `DATABASE_URL` (session pooler `aws-1-us-west-2.pooler.supabase.com:5432`, in `.env.local`, gitignored).
- **Phase 1 — Backup:** `scripts/export-ledger-backup.mjs` → `~/hundie-backups/stage2-2026-06-29_05-12-13/` (13 tables, 28,498 wipe rows; double integrity-checked). Phase-7 baselines: `PHASE7-BASELINE.json` in that dir.
- **Phase 2 — Snapshot:** `scripts/stage2/snapshot-training.sql` via MCP → 3,180 `hundie_snapshot` rows into `qb_training_expenses` (now 7,012), all `import_batch_id=NULL`.
- **Phase 3 — Apply:** `scripts/stage2/apply-migrations.mjs --dry-run` (rolled back, clean) then `--apply` (COMMIT). All 28 ok. Verified: new cols/tables present, 211 categories all kinded, 0 orphans, `sync_from_date` NOT NULL, transactional data untouched.
- **STOPPED before** the deploy (step 4) and Phase 4 (the wipe) per operator instruction.
