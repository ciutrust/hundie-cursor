-- Plaid bank connections: one row per linked institution login (a Plaid "Item").
-- Holds the encrypted access token + the /transactions/sync cursor.
-- Single-operator app, so no user_id (consistent with the rest of the ledger).
--
-- SECURITY: access_token_cipher is AES-256-GCM ciphertext produced by lib/crypto/secret-box
-- (app-level encryption; the key lives only in server env). RLS is ENABLED with NO anon or
-- authenticated policies, so the table is unreadable and unwritable via the browser-exposed
-- publishable key. ALL access is server-side through the service-role client (offline scripts +
-- the Plaid API routes), which bypasses RLS. The cipher never reaches the browser.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'connection_status') then
    create type connection_status as enum ('healthy', 'needs_reauth', 'error');
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
  -- window (which would double-count, since CSV and Plaid rows hash differently). Defaults to the
  -- connection date: CSV covers history, Plaid takes over going forward. Default applies on insert;
  -- re-linking (upsert) omits this column so the original cutover is preserved.
  sync_from_date date default current_date,
  status connection_status not null default 'healthy',
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table bank_connections enable row level security;
-- Intentionally no policies: deny-all for anon/authenticated; service-role bypasses RLS.
