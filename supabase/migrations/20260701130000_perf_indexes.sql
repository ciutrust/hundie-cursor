-- Performance: index the columns the period and backlog queries scan as the ledger grows.
--
-- Review/report queries filter transactions by a transaction_date range across ALL
-- accounts (the existing index is on (account_id, transaction_date), which doesn't
-- serve an all-account date scan). The backlog/entity queries filter classifications
-- by entity_id + (null) category_id. At ~6k rows these are fast either way; these
-- indexes keep them fast as the ledger grows.
--
-- DDL — apply with `supabase db push` (or the dashboard SQL editor); cannot be applied
-- via the service-role REST client.

create index if not exists transactions_transaction_date_idx
  on transactions (transaction_date);

create index if not exists classifications_entity_category_idx
  on classifications (entity_id, category_id);
