-- QuickBooks-aligned categories and training expense ledger (GBSL)

create table categories (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities (id) on delete cascade,
  name text not null,
  parent_id uuid references categories (id) on delete set null,
  full_path text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_id, full_path)
);

create index categories_entity_id_idx on categories (entity_id);
create index categories_parent_id_idx on categories (parent_id);

create table import_batches (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  source_file text not null,
  entity_id uuid references entities (id) on delete set null,
  row_count int not null default 0,
  imported_at timestamptz not null default now()
);

create table qb_training_expenses (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities (id) on delete cascade,
  category_id uuid references categories (id) on delete set null,
  import_batch_id uuid references import_batches (id) on delete set null,
  source_account text not null,
  transaction_date date not null,
  transaction_type text not null,
  transaction_num text,
  vendor_name text,
  description text,
  category_name text not null,
  amount numeric(12, 2) not null,
  import_hash text not null,
  created_at timestamptz not null default now(),
  unique (entity_id, import_hash)
);

create index qb_training_expenses_entity_date_idx
  on qb_training_expenses (entity_id, transaction_date);

create index qb_training_expenses_category_id_idx
  on qb_training_expenses (category_id);

create index qb_training_expenses_vendor_idx
  on qb_training_expenses (entity_id, vendor_name);

alter table categories enable row level security;
alter table import_batches enable row level security;
alter table qb_training_expenses enable row level security;

create policy "Anyone can read categories"
  on categories for select
  to anon, authenticated
  using (true);

create policy "Anyone can read import_batches"
  on import_batches for select
  to anon, authenticated
  using (true);

create policy "Anyone can read qb_training_expenses"
  on qb_training_expenses for select
  to anon, authenticated
  using (true);
