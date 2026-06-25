-- Card and bank account ledger (accounts, transactions, classifications)

create type account_type as enum ('credit_card', 'checking', 'savings');

create table accounts (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  slug text not null unique,
  account_type account_type not null default 'credit_card',
  issuer_parser text not null,
  default_entity_id uuid references entities (id) on delete set null,
  date_rules jsonb not null default '[]'::jsonb,
  mixed_use boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index accounts_default_entity_id_idx on accounts (default_entity_id);
create index accounts_issuer_parser_idx on accounts (issuer_parser);

alter table import_batches
  add column account_id uuid references accounts (id) on delete set null;

create table transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts (id) on delete cascade,
  import_batch_id uuid references import_batches (id) on delete set null,
  transaction_date date not null,
  posted_date date,
  amount numeric(12, 2) not null,
  description text not null,
  vendor text,
  raw_category text,
  import_hash text not null,
  created_at timestamptz not null default now(),
  unique (account_id, import_hash)
);

create index transactions_account_date_idx on transactions (account_id, transaction_date);
create index transactions_import_batch_id_idx on transactions (import_batch_id);

create table classifications (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references transactions (id) on delete cascade,
  entity_id uuid not null references entities (id) on delete restrict,
  category_id uuid references categories (id) on delete set null,
  classified_at timestamptz not null default now(),
  classified_by text not null default 'import',
  notes text,
  unique (transaction_id)
);

create index classifications_entity_id_idx on classifications (entity_id);
create index classifications_category_id_idx on classifications (category_id);

create table raw_import_rows (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null references import_batches (id) on delete cascade,
  account_id uuid not null references accounts (id) on delete cascade,
  row_number int not null,
  raw_data jsonb not null,
  created_at timestamptz not null default now()
);

create index raw_import_rows_batch_idx on raw_import_rows (import_batch_id);

alter table accounts enable row level security;
alter table transactions enable row level security;
alter table classifications enable row level security;
alter table raw_import_rows enable row level security;

create policy "Anyone can read accounts"
  on accounts for select
  to anon, authenticated
  using (true);

create policy "Anyone can read transactions"
  on transactions for select
  to anon, authenticated
  using (true);

create policy "Anyone can read classifications"
  on classifications for select
  to anon, authenticated
  using (true);

create policy "Anyone can read raw_import_rows"
  on raw_import_rows for select
  to anon, authenticated
  using (true);

-- Seed accounts for Jan–Jun 2026 card CSV backfill

insert into accounts (display_name, slug, account_type, issuer_parser, default_entity_id, date_rules, mixed_use)
select
  v.display_name,
  v.slug,
  v.account_type::account_type,
  v.issuer_parser,
  e.id,
  v.date_rules::jsonb,
  v.mixed_use
from (
  values
    ('United Chase Claudia', 'united-chase-claudia', 'credit_card', 'chase', 'personal', '[]', false),
    ('Amex Alex Personal', 'amex-alex-personal', 'credit_card', 'amex', 'personal', '[]', false),
    ('WF GBSL Business Line', 'wf-gbsl-business-line', 'credit_card', 'wells_fargo', 'gbsl', '[]', false),
    ('Citi AAdvantage Alex', 'citi-aadvantage-alex', 'credit_card', 'citi', 'personal', '[]', false),
    ('Citi Strata Claudia', 'citi-strata-claudia', 'credit_card', 'citi', 'personal', '[]', false),
    (
      'Cap One Claudia Quicksilver',
      'cap-one-quicksilver-claudia',
      'credit_card',
      'capital_one',
      'personal',
      '[{"until":"2025-06-30","entity_slug":"gbsl"},{"from":"2025-07-01","entity_slug":"personal"}]',
      false
    ),
    ('Cap One Austin ACAA Green', 'cap-one-acaa-austin', 'credit_card', 'capital_one', 'acaa-austin', '[]', false),
    ('Cap One Alex Platinum', 'cap-one-alex-platinum', 'credit_card', 'capital_one', 'personal', '[]', false),
    ('WF GBSL Checking', 'wf-gbsl-checking', 'checking', 'wells_fargo', 'gbsl', '[]', false),
    ('WF Personal Card', 'wf-personal-cc', 'credit_card', 'wells_fargo', 'personal', '[]', false)
) as v(display_name, slug, account_type, issuer_parser, entity_slug, date_rules, mixed_use)
join entities e on e.slug = v.entity_slug;
