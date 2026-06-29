-- BUG-01: stable per-transaction identity for aggregator (Plaid) rows.
-- Plaid `modified` events reuse the same transaction_id; without a stable id they re-insert
-- (import_hash bakes in amount+description, which a `modified` can change). CSV rows have no
-- external id and continue to dedup via UNIQUE(account_id, import_hash) — they stay exempt here.
--
-- ADDITIVE ONLY: new nullable column + a PARTIAL unique index (no data mutation, no drop).
-- Existing rows keep external_id NULL, so the partial index covers zero rows on apply.
-- NOTE: any operational backfill of external_id for already-imported Plaid rows is Stage 2,
-- not this migration.

alter table transactions
  add column if not exists external_id text;

-- A Plaid transaction_id is unique within an account; routing `modified` to UPDATE-by-external_id
-- depends on this. Partial (WHERE external_id IS NOT NULL) so the many CSV rows are unaffected and
-- multiple NULLs never collide. Also serves the existence lookup in partitionRowsByExistingExternalId.
create unique index if not exists transactions_account_external_id_key
  on transactions (account_id, external_id)
  where external_id is not null;
