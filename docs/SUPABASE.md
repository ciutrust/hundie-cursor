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
- `SUPABASE_SERVICE_ROLE_KEY` — service role key from **Project Settings → API** (required for `npm run import:cards` write mode and `npm run verify:db`; never commit)

Never commit `.env.local` or the service role key.

## Security — RLS (Row Level Security)

Hundie is deployed on Vercel. The **publishable (anon) key** is in the browser bundle and is public.

| Role | Ledger SELECT | Writes |
|------|---------------|--------|
| `anon` (no session) | **Denied** — returns `[]` | Denied |
| `authenticated` (signed-in Alex/Claudia) | Allowed (`USING (true)`) | UPDATE classifications/accounts; INSERT suggestion_events |
| `service_role` (import scripts only) | Bypasses RLS | Full access for imports |

**Migration:** `20260629140000_lock_anon_select_to_authenticated.sql` — replaced all `"Anyone can read …"` policies with `"Authenticated users can read …"`. **Committed on `main` and applied** to project `ihciuqpiavxhbulfkwod`.

**App-layer auth:** `middleware.ts` protects `/review`, `/reports`, and `/settings` (defense in depth alongside RLS).

### Verify anon is locked out

```bash
source .env.local

# Expect [] (empty array) — NOT transaction rows
curl -s "${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/transactions?select=id,description,amount&limit=3" \
  -H "apikey: ${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}" \
  -H "Authorization: Bearer ${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}"
```

Signed-in app smoke test: log in → `/review` → entity drill-down → `/reports`.

### Key rotation

RLS closes the read hole regardless, but consider rotating the publishable key since it was public in the bundle.

## Migrations

SQL migrations live in `supabase/migrations/`. Apply with Supabase CLI (`supabase db push`) or Supabase MCP `apply_migration`.

### Applied (remote)

| Migration | Description |
|-----------|-------------|
| `20260625000000_create_entities` | Entity registry + seed |
| `20260625120000_create_categories_and_qb_training` | categories, import_batches, qb_training_expenses |
| `20260625140000_create_accounts_and_transactions` | accounts, transactions, classifications, raw_import_rows |
| `20260625160000_classification_history_and_rls_writes` | classification_history + authenticated UPDATE on classifications |
| `20260626120000_seed_personal_categories` | Personal category chart |
| `20260627120000_rental_categories_and_account_settings` | Rental categories + account UPDATE policy |
| `20260628120000_create_suggestion_events` | suggestion_events + authenticated INSERT |
| `20260629120000_add_transfer_and_rental_categories` | GBSL transfers, rental fees, Personal CC interest |
| `20260629140000_lock_anon_select_to_authenticated` | **Security:** authenticated-only SELECT on all ledger tables |
| `20260630120000_create_ai_suggestions` | AI pre-classifier staging table + RLS |
| `20260630140000_quicksilver_re_resolve_to_gbsl` | Quicksilver date_rules 2026 + re-resolve mis-booked entity |

## Card CSV import

Issuer parsers: Wells Fargo, Chase, Amex, Citi, Capital One (`scripts/lib/*-csv-parser.mjs`).

```bash
# Parse all CSVs locally (no DB, no secrets)
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

Uses `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS). Lists entities from the `entities` table. Falls back to publishable key with a warning if service role is unset — that path returns empty after the RLS migration.
