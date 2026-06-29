-- WS-G ACCT-12 — account reconciliations (tie each account to a statement period).
--
-- FILE ONLY / STAGE-2: this migration is NOT applied at runtime now. Additive Stage-1 schema
-- foundation; an operator applies the 20260706* batch at Stage 2. No app/lib/script reads it yet.
--
-- One row per account per statement period. beginning/ending balances come from the statement;
-- cleared_balance is the sum of cleared ledger activity the reconciliation matched. reconciled_at /
-- reconciled_by are null until the period is signed off. Balance columns use numeric(14,2) to match
-- the money convention used elsewhere in the ledger (transactions.amount is numeric(12,2);
-- fixed_assets.cost_basis is numeric(14,2)).
--
-- SECURITY: RLS enabled, authenticated-only (matches the ledger lockdown since 20260629140000).
-- Mirrors the ai_suggestions policy set (select / insert / update; deletes via service-role client).

create table if not exists account_reconciliations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts (id) on delete cascade,
  period_start date,
  period_end date,
  beginning_balance numeric(14, 2),
  ending_balance numeric(14, 2),
  cleared_balance numeric(14, 2),
  reconciled_at timestamptz,
  reconciled_by text,
  created_at timestamptz not null default now()
);

create index if not exists account_reconciliations_account_id_idx
  on account_reconciliations (account_id);
create index if not exists account_reconciliations_period_end_idx
  on account_reconciliations (period_end);

alter table account_reconciliations enable row level security;

drop policy if exists "Authenticated users can read account_reconciliations" on account_reconciliations;
create policy "Authenticated users can read account_reconciliations"
  on account_reconciliations for select
  to authenticated
  using (true);

drop policy if exists "Authenticated users can insert account_reconciliations" on account_reconciliations;
create policy "Authenticated users can insert account_reconciliations"
  on account_reconciliations for insert
  to authenticated
  with check (true);

drop policy if exists "Authenticated users can update account_reconciliations" on account_reconciliations;
create policy "Authenticated users can update account_reconciliations"
  on account_reconciliations for update
  to authenticated
  using (true)
  with check (true);
