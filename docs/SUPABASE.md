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
- `SUPABASE_SERVICE_ROLE_KEY` — service role key from **Project Settings → API** (required for `npm run import:cards:apply` write mode and `npm run verify:db`; never commit)

Never commit `.env.local` or the service role key.

## Security — RLS (Row Level Security)

Hundie is deployed on Vercel. The **publishable (anon) key** is in the browser bundle and is public.

| Role | Ledger SELECT | Writes |
|------|---------------|--------|
| `anon` (no session) | **Denied** — returns `[]` | Denied |
| `authenticated` (signed-in Alex/Claudia) | Allowed (`USING (true)`) | UPDATE classifications/accounts; INSERT suggestion_events |
| `service_role` (import scripts only) | Bypasses RLS | Full access for imports |

**Migration:** `20260629140000_lock_anon_select_to_authenticated.sql` — replaced all `"Anyone can read …"` policies with `"Authenticated users can read …"`. **Committed on `main` and applied** to project `ihciuqpiavxhbulfkwod`.

**App-layer auth:** `proxy.ts` + `lib/supabase/middleware.ts` protect `/review`, `/reports`, `/categories`, `/month-close`, `/tax-close`, and `/settings` (defense in depth alongside RLS).

### Self-signup is disabled (allowlist model)

RLS trusts *any* authenticated JWT (`USING (true)`), so who can obtain a JWT is the real trust boundary. Sign-in is allowlist-only:

- **Client:** `login-form.tsx` sends magic links via `magicLinkOtpOptions()` (`lib/auth/sign-in-options.ts`) with `shouldCreateUser: false` — an OTP request for an unknown email fails instead of creating a user.
- **Dashboard:** Authentication → Providers → Email → **"Allow new users to sign up" = OFF** (project `ihciuqpiavxhbulfkwod`). Verified 2026-07-02.

Until per-user RLS exists (no `user_id` columns yet), do NOT enable signups. Adding a user = invite from the dashboard only.

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

### Hardening status & operator follow-ups (Review 2026-07-01, Track 2)

**Shipped (code / migrations):**

- **Audit-trail integrity (S2 / S8):** `log_classification_change` and `log_transaction_change` now set `changed_by` from the authenticated JWT email — `coalesce(auth.jwt()->>'email', <app provenance>)` — so a client-forged `classified_by` can no longer spoof the trail; service-role/import writes (no JWT email) keep their existing provenance. Both `SECURITY DEFINER` trigger functions had their RPC `EXECUTE` grant revoked from `public, anon, authenticated`. Migration `20260709120000_harden_audit_triggers`.
- **Defense-in-depth reads (S3 / S5):** `getConnections()` requires an authenticated user before the service-role read; `/categories` is now inside the auth matcher.

**Accepted single-tenant risk (documented, intentionally NOT changed):**

- The ledger write policies are `USING (true)` / `WITH CHECK (true)` for `authenticated` (the advisor's `rls_policy_always_true` list). This is intentional for the "authenticated = owner" model. **Tightening them to require `aal2` is deferred** — it would lock the operator out of writes unless BOTH accounts have enrolled an MFA factor. Do it only after confirming MFA enrollment for Alex and Claudia.

**Operator dashboard actions still open:**

- **S9 — Leaked-password protection (HIBP):** Dashboard → Authentication → Policies → enable "Leaked password protection" (checks HaveIBeenPwned). Project `ihciuqpiavxhbulfkwod`. **Not yet enabled** (advisor still warns).
- **S11 — Rate limiting:** login and the MFA challenge rely on Supabase's default auth rate limits (no app-level lockout). Optionally add a per-IP throttle via a Vercel WAF rule for the auth routes and `/api/plaid/*`.
- **S10 — key fingerprint:** the displayed encryption-key fingerprint is still a raw SHA-256 (display-only, not stored/compared). Switching it to an HMAC is safe but changes the displayed value; do it in a follow-up if desired.

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
| `20260701120000_mortgage_heloc_payment_categories` | Counted `Mortgage payment` + `HELOC payment` on Pflugerville, Austin ACAA, Personal |
| `20260701130000_perf_indexes` | Indexes on `transactions(transaction_date)` + `classifications(entity_id, category_id)` |

Later migrations (Stage-2 through the 2026-07-02 perf review, `20260702*`–`20260710*`) live in `supabase/migrations/` and were applied to the remote via Supabase MCP `apply_migration`. The remediation-pass migrations:

| Migration | Description |
|-----------|-------------|
| `20260706120000`–`20260706150000` (4) | Categories: Job W2 Expenses, Income tax — federal (prior year), Keller Phone & Internet, Keller CC payment |
| `20260709120000_harden_audit_triggers` | **Security (S2/S8):** `changed_by` from JWT identity + `revoke execute` on both audit trigger fns |
| `20260709121000_fk_covering_indexes` | **Perf (T6):** covering indexes for FKs on the active tables |
| `20260710120000_perf_indexes` | **Perf (D1/D2/D4):** proposals `(entity_slug,status,vendor_key,id)` composite (drop mismatched entity_id-keyed); `pg_trgm` GIN indexes for ILIKE scans; drop dead small-table indexes |

## Card CSV import

Issuer parsers: Wells Fargo, Chase, Amex, Citi, Capital One (`scripts/lib/*-csv-parser.mjs`).

```bash
# Parse all CSVs locally (no DB, no secrets) — bare import:cards is dry-run
npm run import:cards
npm run verify:card-parsers

# Write to Supabase (needs SUPABASE_SERVICE_ROLE_KEY in .env.local)
npm run import:cards:apply

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
