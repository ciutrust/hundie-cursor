-- Log suggestion accept/reject/manual for progressive learning

create table suggestion_events (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid references transactions (id) on delete set null,
  classification_id uuid references classifications (id) on delete cascade,
  entity_id uuid not null references entities (id) on delete cascade,
  vendor_key text not null default '',
  suggested_category_id uuid references categories (id) on delete set null,
  chosen_category_id uuid references categories (id) on delete set null,
  event_type text not null check (event_type in ('accept', 'reject', 'manual')),
  suggestion_source text,
  created_at timestamptz not null default now(),
  created_by text
);

create index suggestion_events_entity_vendor_idx
  on suggestion_events (entity_id, vendor_key);

create index suggestion_events_created_at_idx
  on suggestion_events (created_at desc);

alter table suggestion_events enable row level security;

create policy "Anyone can read suggestion_events"
  on suggestion_events for select
  to anon, authenticated
  using (true);

create policy "Authenticated users can insert suggestion_events"
  on suggestion_events for insert
  to authenticated
  with check (true);
