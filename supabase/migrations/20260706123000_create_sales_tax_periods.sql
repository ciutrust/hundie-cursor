-- WS-G ACCT-14 — sales-tax periods (Texas sales-tax return support).
--
-- FILE ONLY / STAGE-2: this migration is NOT applied at runtime now. Additive Stage-1 schema
-- foundation; an operator applies the 20260706* batch at Stage 2. No app/lib/script reads it yet.
--
-- One row per entity per filing period per jurisdiction. collected is sales tax billed to customers;
-- remitted is what was paid to the jurisdiction. filed_at is null until the return is submitted.
-- Money columns use numeric(14,2) to match the ledger's money convention.
--
-- SECURITY: RLS enabled, authenticated-only (matches the ledger lockdown since 20260629140000).
-- Mirrors the ai_suggestions policy set (select / insert / update; deletes via service-role client).

create table if not exists sales_tax_periods (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities (id) on delete cascade,
  period_start date,
  period_end date,
  collected numeric(14, 2),
  remitted numeric(14, 2),
  jurisdiction text,
  filed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists sales_tax_periods_entity_id_idx on sales_tax_periods (entity_id);
create index if not exists sales_tax_periods_entity_period_end_idx
  on sales_tax_periods (entity_id, period_end);

alter table sales_tax_periods enable row level security;

drop policy if exists "Authenticated users can read sales_tax_periods" on sales_tax_periods;
create policy "Authenticated users can read sales_tax_periods"
  on sales_tax_periods for select
  to authenticated
  using (true);

drop policy if exists "Authenticated users can insert sales_tax_periods" on sales_tax_periods;
create policy "Authenticated users can insert sales_tax_periods"
  on sales_tax_periods for insert
  to authenticated
  with check (true);

drop policy if exists "Authenticated users can update sales_tax_periods" on sales_tax_periods;
create policy "Authenticated users can update sales_tax_periods"
  on sales_tax_periods for update
  to authenticated
  using (true)
  with check (true);
