-- Splits-writer PR (part 1/2) — mark a transaction as split.
--
-- When `split_at` is set, the parent transaction's OWN classification is excluded (as a whole) from
-- every expense / CPA / backlog rollup, and its N rows in `transaction_splits` (each entity+category+
-- amount, summing to the parent) are counted instead. The parent stays the single real bank line, so
-- reconciliation / intercompany / Plaid are untouched — a split is an allocation OVERLAY, not a change
-- to bank truth.
--
-- This mirrors `plaid_removed_at` (20260703140000) EXACTLY: additive, nullable timestamptz, partial
-- index, read-side filter `.is('split_at', null)`. Like plaid_removed_at, setting split_at does NOT
-- trip log_transaction_change() (20260708120000 / hardened 20260709120000) — that trigger fires only
-- when amount/transaction_date/description is distinct from. Idempotent.

alter table transactions
  add column if not exists split_at timestamptz;

create index if not exists transactions_split_at_idx
  on transactions (split_at)
  where split_at is not null;

-- Speeds the entity-scoped leg fetch (fetchLedgerExpenseLines Fetch B filters legs by their OWN
-- entity_id, which differs from the parent classification's entity).
create index if not exists transaction_splits_entity_id_idx
  on transaction_splits (entity_id);
