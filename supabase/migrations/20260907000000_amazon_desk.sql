-- Amazon desk — personal Orders export ingest + charge↔shipment linking.
--
-- Card charges are per shipment (order_id + ship_date), not per order. Import batches
-- hold Order History rows; charge links suggest/confirm matches into the ledger.
-- Business API sync later uses the same tables with source = 'business_api'.
--
-- SECURITY: RLS authenticated-only (select/insert/update); deletes via service-role if needed.

create table if not exists amazon_import_batches (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('personal_export', 'business_api')),
  file_name text,
  item_count int not null default 0,
  shipment_count int not null default 0,
  uploaded_by text,
  created_at timestamptz not null default now()
);

create table if not exists amazon_shipments (
  id uuid primary key default gen_random_uuid(),
  shipment_key text not null,
  order_id text not null,
  ship_date date,
  order_date date,
  -- Competing reconstructions of the card charge (owed_sum, line_total, …) in integer cents.
  amounts jsonb not null default '{}'::jsonb,
  payment_method text,
  last4 text,
  store_card boolean not null default false,
  is_digital boolean not null default false,
  order_url text not null,
  import_batch_id uuid references amazon_import_batches (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shipment_key)
);

create index if not exists amazon_shipments_order_id_idx on amazon_shipments (order_id);
create index if not exists amazon_shipments_ship_date_idx on amazon_shipments (ship_date);

create table if not exists amazon_shipment_items (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references amazon_shipments (id) on delete cascade,
  asin text,
  product_name text not null default '',
  quantity int not null default 1,
  unit_price_cents int,
  unit_tax_cents int,
  line_total_cents int,
  asin_url text,
  sort_index int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists amazon_shipment_items_shipment_id_idx
  on amazon_shipment_items (shipment_id);

create table if not exists amazon_charge_links (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references transactions (id) on delete cascade,
  shipment_id uuid references amazon_shipments (id) on delete set null,
  match_tier text not null check (match_tier in ('A', 'B', 'C', 'manual')),
  match_hypothesis text,
  date_delta int,
  -- Candidate shipments when tier B (ambiguous): [{shipment_id, hypothesis, date_delta}, …]
  candidates jsonb not null default '[]'::jsonb,
  status text not null default 'suggested'
    check (status in ('suggested', 'confirmed', 'rejected')),
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (transaction_id)
);

create index if not exists amazon_charge_links_status_idx on amazon_charge_links (status);
create index if not exists amazon_charge_links_shipment_id_idx on amazon_charge_links (shipment_id);

alter table amazon_import_batches enable row level security;
alter table amazon_shipments enable row level security;
alter table amazon_shipment_items enable row level security;
alter table amazon_charge_links enable row level security;

drop policy if exists "Authenticated users can read amazon_import_batches" on amazon_import_batches;
create policy "Authenticated users can read amazon_import_batches"
  on amazon_import_batches for select to authenticated using (true);

drop policy if exists "Authenticated users can insert amazon_import_batches" on amazon_import_batches;
create policy "Authenticated users can insert amazon_import_batches"
  on amazon_import_batches for insert to authenticated with check (true);

drop policy if exists "Authenticated users can update amazon_import_batches" on amazon_import_batches;
create policy "Authenticated users can update amazon_import_batches"
  on amazon_import_batches for update to authenticated using (true) with check (true);

drop policy if exists "Authenticated users can read amazon_shipments" on amazon_shipments;
create policy "Authenticated users can read amazon_shipments"
  on amazon_shipments for select to authenticated using (true);

drop policy if exists "Authenticated users can insert amazon_shipments" on amazon_shipments;
create policy "Authenticated users can insert amazon_shipments"
  on amazon_shipments for insert to authenticated with check (true);

drop policy if exists "Authenticated users can update amazon_shipments" on amazon_shipments;
create policy "Authenticated users can update amazon_shipments"
  on amazon_shipments for update to authenticated using (true) with check (true);

drop policy if exists "Authenticated users can delete amazon_shipments" on amazon_shipments;
create policy "Authenticated users can delete amazon_shipments"
  on amazon_shipments for delete to authenticated using (true);

drop policy if exists "Authenticated users can read amazon_shipment_items" on amazon_shipment_items;
create policy "Authenticated users can read amazon_shipment_items"
  on amazon_shipment_items for select to authenticated using (true);

drop policy if exists "Authenticated users can insert amazon_shipment_items" on amazon_shipment_items;
create policy "Authenticated users can insert amazon_shipment_items"
  on amazon_shipment_items for insert to authenticated with check (true);

drop policy if exists "Authenticated users can update amazon_shipment_items" on amazon_shipment_items;
create policy "Authenticated users can update amazon_shipment_items"
  on amazon_shipment_items for update to authenticated using (true) with check (true);

drop policy if exists "Authenticated users can delete amazon_shipment_items" on amazon_shipment_items;
create policy "Authenticated users can delete amazon_shipment_items"
  on amazon_shipment_items for delete to authenticated using (true);

drop policy if exists "Authenticated users can read amazon_charge_links" on amazon_charge_links;
create policy "Authenticated users can read amazon_charge_links"
  on amazon_charge_links for select to authenticated using (true);

drop policy if exists "Authenticated users can insert amazon_charge_links" on amazon_charge_links;
create policy "Authenticated users can insert amazon_charge_links"
  on amazon_charge_links for insert to authenticated with check (true);

drop policy if exists "Authenticated users can update amazon_charge_links" on amazon_charge_links;
create policy "Authenticated users can update amazon_charge_links"
  on amazon_charge_links for update to authenticated using (true) with check (true);

drop policy if exists "Authenticated users can delete amazon_charge_links" on amazon_charge_links;
create policy "Authenticated users can delete amazon_charge_links"
  on amazon_charge_links for delete to authenticated using (true);
