-- BUG-09/DATA-02: stamp (don't delete) transactions Plaid reports as removed/reversed.
-- A removed row may carry a human classification, so it is surfaced for review instead of deleted.
-- runPlaidSync locates the row by transactions.external_id (added by BUG-01) and sets this column.
-- Additive + nullable: no backfill, no data mutation. Partial index keeps the "needs review" scan cheap.

alter table transactions
  add column if not exists plaid_removed_at timestamptz;

create index if not exists transactions_plaid_removed_at_idx
  on transactions (plaid_removed_at)
  where plaid_removed_at is not null;
