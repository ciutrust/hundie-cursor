-- BUG-06: bank_connections.sync_from_date must be NOT NULL.
--
-- A NULL sync_from_date makes runPlaidSync pull FULL history (dateFrom=null), double-counting the
-- CSV-backfilled window: CSV rows and Plaid rows hash differently, so UNIQUE(account_id, import_hash)
-- does NOT dedupe them. The column already defaults to current_date on insert
-- (20260702120000_create_bank_connections.sql); this migration backfills any pre-existing NULLs and
-- enforces NOT NULL going forward.
--
-- STAGE-1 NOTE (do not apply in the non-destructive Stage-1 pass): the UPDATE below is a one-time
-- data mutation required before NOT NULL can be added, so this file is applied in STAGE 2, AFTER the
-- operator sets the real cutover date per connection. The backfill is a conservative fallback only:
-- a connection cannot have transactions dated before it was created, so created_at::date is a safe
-- lower bound. The load-bearing Stage-1 protection is the resolveSyncFromDate() guard in
-- lib/plaid/run-sync.ts, which falls back to "today" (never full history) when sync_from_date is null.

update bank_connections
  set sync_from_date = coalesce(sync_from_date, created_at::date, current_date)
  where sync_from_date is null;

alter table bank_connections
  alter column sync_from_date set default current_date;

alter table bank_connections
  alter column sync_from_date set not null;
