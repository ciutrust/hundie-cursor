-- WS-G TAX-08 — fixed-assets register (feeds the annual Form 4562 / depreciation schedule).
--
-- FILE ONLY / STAGE-2: this migration is NOT applied at runtime now. Additive Stage-1 schema
-- foundation; an operator applies the 20260706* batch at Stage 2. No app/lib/script reads it yet.
--
-- One row per depreciable asset. method/recovery_period_years describe the depreciation convention
-- (e.g. 'MACRS' / 5). section_179, bonus_depreciation, accumulated_depreciation are running dollar
-- amounts (not-null, default 0 so a freshly-added asset has a clean basis). disposed_date is set when
-- the asset leaves service. category_id links the asset to its chart-of-accounts category.
--
-- SECURITY: RLS enabled, authenticated-only (matches the ledger lockdown since 20260629140000).
-- Mirrors the ai_suggestions policy set (select / insert / update; deletes via service-role client).

create table if not exists fixed_assets (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities (id) on delete cascade,
  description text not null,
  category_id uuid references categories (id) on delete set null,
  in_service_date date,
  cost_basis numeric(14, 2),
  method text,
  recovery_period_years numeric,
  section_179 numeric(14, 2) not null default 0,
  bonus_depreciation numeric(14, 2) not null default 0,
  accumulated_depreciation numeric(14, 2) not null default 0,
  disposed_date date,
  created_at timestamptz not null default now()
);

create index if not exists fixed_assets_entity_id_idx on fixed_assets (entity_id);
create index if not exists fixed_assets_category_id_idx on fixed_assets (category_id);

alter table fixed_assets enable row level security;

drop policy if exists "Authenticated users can read fixed_assets" on fixed_assets;
create policy "Authenticated users can read fixed_assets"
  on fixed_assets for select
  to authenticated
  using (true);

drop policy if exists "Authenticated users can insert fixed_assets" on fixed_assets;
create policy "Authenticated users can insert fixed_assets"
  on fixed_assets for insert
  to authenticated
  with check (true);

drop policy if exists "Authenticated users can update fixed_assets" on fixed_assets;
create policy "Authenticated users can update fixed_assets"
  on fixed_assets for update
  to authenticated
  using (true)
  with check (true);
