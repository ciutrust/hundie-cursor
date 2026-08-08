-- Plaid accounts the operator deliberately does NOT track — an explicit, persisted "never import this".
--
-- WHY: /transactions/sync is forward-only, so lib/plaid/run-sync.ts refuses to advance the cursor while
-- any incoming Plaid account has no plaid_account_links row (C2) — dropping an `added` row would lose it
-- permanently. That guard had no way to hear "I know about that account and I am never tracking it", so
-- two Wells Fargo connections sat pinned at status 'needs_mapping': 4 accounts that will never be in the
-- ledger (untracked personal savings, two not-yet-active trust accounts, a business card the operator
-- isn't ready to track) held the cursor, froze last_synced_at, and made every sync replay an
-- ever-growing window — while the mapped sibling accounts on the same connections imported fine.
-- "Skip" in the mapping UI is a per-session no-op, so the decision could be made but never stuck.
--
-- A row here marks that Plaid account RESOLVED for the cursor gate, and for nothing else: run-sync
-- counts it as answered, so a connection with no genuinely-unresolved accounts persists sync_cursor +
-- last_synced_at and returns to 'healthy'. It is deliberately NOT a link — an ignored account has no
-- plaid_account_links row, so run-sync's accountIdByPlaid never learns this plaid_account_id and the
-- per-account guard (`const accountId = accountIdByPlaid.get(...); if (!accountId) continue;`) still
-- drops every one of its transactions before import. Ignoring changes WHEN the cursor advances, never
-- WHAT gets imported. Ignored ids must never be seeded into that routing map.
--
-- Ignoring must NOT touch sync_cursor or sync_from_date. The held cursor is already correctly
-- positioned; the next sync simply advances from where it stopped, so nothing is skipped.
--
-- REVERSIBLE by design: delete the row and the account is unresolved again — the next sync flips the
-- connection back to 'needs_mapping' and it can be mapped normally. An account that ALREADY has a
-- plaid_account_links row cannot be ignored (the API rejects it); that would be an unmap, which would
-- strand entity routing for transactions already in the ledger.
--
-- SECURITY: RLS enabled, no anon/authenticated policies -> service-role only, same as
-- plaid_account_links and bank_connections. Idempotent.

create table if not exists plaid_ignored_accounts (
  id uuid primary key default gen_random_uuid(),
  -- Cascade matches plaid_account_links: removing a bank should forget its ignore decisions too,
  -- since re-linking starts the mapping conversation over from scratch.
  connection_id uuid not null references bank_connections (id) on delete cascade,
  -- Unique table-wide, exactly like plaid_account_links. A Plaid account_id is globally unique and
  -- "not tracked" is a global fact, so run-sync can load the whole set once for every connection.
  plaid_account_id text not null unique,
  -- Snapshot of what Plaid showed when the decision was made, so the settings UI can name the account
  -- ("EVERYDAY CHECKING ...5435") without a live accountsGet just to render an ignored row.
  plaid_name text,
  plaid_mask text,
  plaid_type text,
  -- Free text in the operator's own words ("untracked personal savings", "trust not active yet").
  -- Optional: the decision is the row's existence, not its justification.
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists plaid_ignored_accounts_connection_idx
  on plaid_ignored_accounts (connection_id);

alter table plaid_ignored_accounts enable row level security;
-- Intentionally no policies: service-role only.
