# Supabase

## Project

- **Name:** Hundie Project
- **Ref:** `ihciuqpiavxhbulfkwod`
- **URL:** `https://ihciuqpiavxhbulfkwod.supabase.co`
- **Org:** ciutrust's Org
- **Region:** us-west-2

Dashboard: https://supabase.com/dashboard/project/ihciuqpiavxhbulfkwod

## Local environment

Copy `.env.local.example` to `.env.local` and set:

- `NEXT_PUBLIC_SUPABASE_URL` — project URL
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — publishable key (`sb_publishable_...`) from **Project Settings → API**
- `SUPABASE_SERVICE_ROLE_KEY` — service role key from **Project Settings → API** (required for `npm run import:cards` write mode; never commit)

Never commit `.env.local` or the service role key.

## Migrations

SQL migrations live in `supabase/migrations/`. Apply with Supabase CLI (`supabase db push`) or Supabase MCP `apply_migration`.

### Applied (remote)

| Migration | Description |
|-----------|-------------|
| `create_entities` | Entity registry table + seed data (10 entities) |
| `create_categories_and_qb_training` | QB-aligned categories, import_batches, qb_training_expenses |
| `create_accounts_and_transactions` | accounts, transactions, classifications, raw_import_rows + 10 card/checking account seeds |

## Card CSV import

Issuer parsers: Wells Fargo, Chase, Amex, Citi, Capital One (`scripts/lib/*-csv-parser.mjs`).

```bash
# Parse all 10 CSVs locally (no DB, no secrets)
npm run import:cards:dry-run
npm run verify:card-parsers

# Write to Supabase (needs SUPABASE_SERVICE_ROLE_KEY in .env.local)
npm run import:cards

# Post-import counts
npm run import:cards:verify
```

**One-time setup:** Add `SUPABASE_SERVICE_ROLE_KEY` to `.env.local` from [Dashboard → API → service_role](https://supabase.com/dashboard/project/ihciuqpiavxhbulfkwod/settings/api). Same key you may have added to Vercel — server-only, never commit.

Without service role key, generate SQL and import via Supabase MCP `execute_sql`:

```bash
npm run import:cards:sql
# Then execute scripts/.card-import-sql/mcp-batches/batch-*.sql via MCP (10 files, in order)
```

## Verify connection

```bash
npm run verify:db
```

Expected output: lists 10 entities from the `entities` table.
