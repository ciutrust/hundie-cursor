-- Entity registry (names only for v1)

create type entity_status as enum ('active', 'dormant', 'trust');

create table entities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status entity_status not null default 'active',
  is_classifiable boolean not null default false,
  display_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index entities_status_idx on entities (status);
create index entities_classifiable_idx on entities (is_classifiable) where is_classifiable = true;

alter table entities enable row level security;

create policy "Anyone can read entities"
  on entities for select
  to anon, authenticated
  using (true);

insert into entities (name, slug, status, is_classifiable, display_order) values
  ('GBSL, LLC', 'gbsl', 'active', true, 1),
  ('Keller Services LLC', 'keller', 'active', true, 2),
  ('Austin ACAA House LLC', 'acaa-austin', 'active', true, 3),
  ('Personal', 'personal', 'active', true, 4),
  ('Pflugerville Rental', 'pflugerville', 'active', true, 5),
  ('Dallas ACAA House LLC', 'dallas-acaa', 'dormant', false, 6),
  ('Jiu Jitsu Coppell LLC', 'jiu-jitsu-coppell', 'dormant', false, 7),
  ('ACAA Management LLC', 'acaa-management', 'dormant', false, 8),
  ('Three Cities Trust', 'three-cities-trust', 'trust', false, 9),
  ('Ciunciusky Spendthrift Trust', 'spendthrift-trust', 'trust', false, 10);
