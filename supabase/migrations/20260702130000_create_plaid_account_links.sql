-- Links a Plaid account (vendor account_id) to an EXISTING seeded Hundie account.
-- This is how Plaid data inherits the account's entity routing (slug, date_rules,
-- default_entity) — we attach to a seeded account, never auto-create a parallel one.
-- Operator-confirmed in the mapping UI; a wrong link would route money to the wrong entity.
--
-- SECURITY: RLS enabled, no anon/authenticated policies -> service-role only, same as
-- bank_connections. Nothing here is secret, but keeping all Plaid tables server-only is the
-- simplest safe posture.

create table if not exists plaid_account_links (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts (id) on delete cascade,
  connection_id uuid not null references bank_connections (id) on delete cascade,
  plaid_account_id text not null unique,
  plaid_name text,
  plaid_mask text,
  plaid_type text,
  created_at timestamptz not null default now(),
  unique (account_id)
);

create index if not exists plaid_account_links_connection_idx
  on plaid_account_links (connection_id);

alter table plaid_account_links enable row level security;
-- Intentionally no policies: service-role only.
