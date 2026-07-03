-- WS-F TAX-09 — mixed-use scaffolding.
--
-- FILE ONLY / STAGE-2: the Home Depot / Best Buy card import and the actual business/personal
-- allocations are Stage-2 data work. accounts.mixed_use already exists (20260625140000); the
-- IF NOT EXISTS keeps a fresh DB correct and is a safe no-op on the live DB.
--
-- transaction_splits lets a single charge be allocated across entities/categories later. amount sign
-- mirrors transactions.amount. RLS authenticated-only, mirroring the ai_suggestions / fixed_assets
-- policy set (select / insert / update; deletes via the service-role client).
--
-- C18 (DEFERRED, intentional): the sum-to-parent invariant (splits must sum to transactions.amount),
-- the rollup exclusion (a split parent must not also be counted whole), and the parity test are
-- INTENTIONALLY DEFERRED to the future splits-writer PR. Guarding an empty table now is dead code
-- that risks getting the netting logic wrong before there is any writer to validate against; the
-- constraint/trigger belongs with the code that first writes splits. Do NOT add the trigger here.

alter table accounts add column if not exists mixed_use boolean not null default false;

create table if not exists transaction_splits (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references transactions (id) on delete cascade,
  entity_id uuid not null references entities (id) on delete restrict,
  category_id uuid references categories (id) on delete set null,
  amount numeric(12, 2) not null,                  -- sign mirrors transactions.amount
  created_at timestamptz not null default now()
);

create index if not exists transaction_splits_transaction_id_idx on transaction_splits (transaction_id);

alter table transaction_splits enable row level security;

drop policy if exists "Authenticated users can read transaction_splits" on transaction_splits;
create policy "Authenticated users can read transaction_splits"
  on transaction_splits for select
  to authenticated
  using (true);

drop policy if exists "Authenticated users can insert transaction_splits" on transaction_splits;
create policy "Authenticated users can insert transaction_splits"
  on transaction_splits for insert
  to authenticated
  with check (true);

drop policy if exists "Authenticated users can update transaction_splits" on transaction_splits;
create policy "Authenticated users can update transaction_splits"
  on transaction_splits for update
  to authenticated
  using (true)
  with check (true);
