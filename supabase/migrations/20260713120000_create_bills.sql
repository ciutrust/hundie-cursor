-- Bills Section (v1) — recurring obligations per entity + per-cycle instances.
--
-- bills is the definition (biller, entity, expected amount, cadence, due day, portal link, match
-- hint). bill_instances is one row per billing cycle (due_date, status open/paid/skipped, and the
-- matched transaction once a payment is confirmed). Instances are generated LAZILY by the app when
-- the /bills dashboard loads — no cron. unique(bill_id, due_date) makes that generation idempotent
-- and race-safe (concurrent loads upsert with ignoreDuplicates).
--
-- Design notes:
--   * text + CHECK(...) for enums (matches the newer additive tables — classification_proposals,
--     payees, transaction_splits — and avoids CREATE TYPE / ALTER TYPE friction).
--   * "due_soon" / "overdue" are NOT stored — they are derived in code from due_date vs today.
--   * No auto-login / stored passwords: portal_url is a link the operator clicks to go pay;
--     login_hint is a username / note only. Hundie never moves money.
--
-- SECURITY: RLS enabled, authenticated-only (matches the ledger lockdown since 20260629140000 — the
-- browser publishable/anon key requires an authenticated session). Mirrors the payees policy set
-- (select / insert / update for authenticated; any hard delete goes through the service-role client).

create table if not exists bills (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities (id) on delete cascade,
  name text not null,
  expected_amount numeric(12, 2),
  amount_varies boolean not null default false,
  cadence text not null check (cadence in ('weekly', 'monthly', 'quarterly', 'semiannual', 'annual', 'one_time')),
  due_day int check (due_day is null or (due_day between 0 and 31)),
  anchor_date date,
  portal_url text,
  login_hint text,
  match_hint text,
  category_id uuid references categories (id) on delete set null,
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bills_entity_id_idx on bills (entity_id);
create index if not exists bills_entity_status_idx on bills (entity_id, status);

create table if not exists bill_instances (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references bills (id) on delete cascade,
  entity_id uuid not null references entities (id) on delete cascade,
  due_date date not null,
  expected_amount numeric(12, 2),
  status text not null default 'open' check (status in ('open', 'paid', 'skipped')),
  paid_at timestamptz,
  paid_amount numeric(12, 2),
  matched_transaction_id uuid references transactions (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bill_id, due_date)
);

create index if not exists bill_instances_bill_id_idx on bill_instances (bill_id);
create index if not exists bill_instances_entity_status_idx on bill_instances (entity_id, status);
create index if not exists bill_instances_due_date_idx on bill_instances (due_date);

alter table bills enable row level security;
alter table bill_instances enable row level security;

-- bills policies
drop policy if exists "Authenticated users can read bills" on bills;
create policy "Authenticated users can read bills"
  on bills for select
  to authenticated
  using (true);

drop policy if exists "Authenticated users can insert bills" on bills;
create policy "Authenticated users can insert bills"
  on bills for insert
  to authenticated
  with check (true);

drop policy if exists "Authenticated users can update bills" on bills;
create policy "Authenticated users can update bills"
  on bills for update
  to authenticated
  using (true)
  with check (true);

-- bill_instances policies
drop policy if exists "Authenticated users can read bill_instances" on bill_instances;
create policy "Authenticated users can read bill_instances"
  on bill_instances for select
  to authenticated
  using (true);

drop policy if exists "Authenticated users can insert bill_instances" on bill_instances;
create policy "Authenticated users can insert bill_instances"
  on bill_instances for insert
  to authenticated
  with check (true);

drop policy if exists "Authenticated users can update bill_instances" on bill_instances;
create policy "Authenticated users can update bill_instances"
  on bill_instances for update
  to authenticated
  using (true)
  with check (true);
