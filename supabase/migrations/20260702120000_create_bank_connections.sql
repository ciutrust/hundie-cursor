-- Plaid bank connections: one row per linked institution login (a Plaid "Item").
-- Holds the encrypted access token + the /transactions/sync cursor.
-- Single-operator app, so no user_id (consistent with the rest of the ledger).
--
-- SECURITY: access_token_cipher is AES-256-GCM ciphertext produced by lib/crypto/secret-box
-- (app-level encryption; the key lives only in server env). RLS is ENABLED with NO anon or
-- authenticated policies, so the table is unreadable and unwritable via the browser-exposed
-- publishable key. ALL access is server-side through the service-role client (offline scripts +
-- the Plaid API routes), which bypasses RLS. The cipher never reaches the browser.

-- 'needs_mapping' (C2): a sync found Plaid accounts with no plaid_account_links row. The
-- forward-only cursor is HELD (not advanced) so those rows re-deliver once the operator maps the
-- accounts, and the connection is flagged for that action instead of reporting healthy.
do $$ begin
  if not exists (select 1 from pg_type where typname = 'connection_status') then
    create type connection_status as enum ('healthy', 'needs_reauth', 'error', 'needs_mapping');
  end if;
end $$;

create table if not exists bank_connections (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'plaid',
  institution text,
  external_item_id text unique,
  access_token_cipher text not null,
  sync_cursor text,
  -- Plaid only imports transactions on/after this date, so it never re-pulls the CSV-backfilled
  -- window (which would double-count, since CSV and Plaid rows hash differently). NO default: the
  -- cutover is set by map-accounts as MAX(transaction_date)+1 of the mapped accounts (or an operator
  -- override), so CSV covers history and Plaid takes over exactly where the ledger left off. A null
  -- (unmapped) connection is caught by run-sync's null-guard (fall back to today + warn).
  sync_from_date date,
  status connection_status not null default 'healthy',
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table bank_connections enable row level security;
-- Intentionally no policies: deny-all for anon/authenticated; service-role bypasses RLS.
