-- Phase A: liabilities, assets, and value history for net-worth tracking.
-- Additive. Same authenticated-only RLS as the ledger. No secrets.

create table if not exists liabilities (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid references entities (id) on delete set null,
  type text not null check (type in ('credit_card', 'mortgage', 'heloc', 'auto_loan', 'business_loan', 'other')),
  name text not null,
  current_balance numeric(14, 2),
  credit_limit numeric(14, 2),
  interest_rate numeric(6, 4),
  due_date date,
  plaid_account_id text,
  notes text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists assets (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid references entities (id) on delete set null,
  type text not null check (type in ('property', 'vehicle', 'brokerage', 'retirement', 'education', 'other')),
  name text not null,
  current_value numeric(14, 2),
  notes text,
  acquired_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists asset_value_history (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references assets (id) on delete cascade,
  valued_on date not null,
  value numeric(14, 2) not null,
  source text not null default 'manual',
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists liabilities_entity_id_idx on liabilities (entity_id);
create index if not exists assets_entity_id_idx on assets (entity_id);
create index if not exists asset_value_history_asset_id_idx on asset_value_history (asset_id);

alter table liabilities enable row level security;
alter table assets enable row level security;
alter table asset_value_history enable row level security;

drop policy if exists "Authenticated users can read liabilities" on liabilities;
create policy "Authenticated users can read liabilities"
  on liabilities for select to authenticated using (true);

drop policy if exists "Authenticated users can insert liabilities" on liabilities;
create policy "Authenticated users can insert liabilities"
  on liabilities for insert to authenticated with check (true);

drop policy if exists "Authenticated users can update liabilities" on liabilities;
create policy "Authenticated users can update liabilities"
  on liabilities for update to authenticated using (true) with check (true);

drop policy if exists "Authenticated users can read assets" on assets;
create policy "Authenticated users can read assets"
  on assets for select to authenticated using (true);

drop policy if exists "Authenticated users can insert assets" on assets;
create policy "Authenticated users can insert assets"
  on assets for insert to authenticated with check (true);

drop policy if exists "Authenticated users can update assets" on assets;
create policy "Authenticated users can update assets"
  on assets for update to authenticated using (true) with check (true);

drop policy if exists "Authenticated users can read asset_value_history" on asset_value_history;
create policy "Authenticated users can read asset_value_history"
  on asset_value_history for select to authenticated using (true);

drop policy if exists "Authenticated users can insert asset_value_history" on asset_value_history;
create policy "Authenticated users can insert asset_value_history"
  on asset_value_history for insert to authenticated with check (true);
