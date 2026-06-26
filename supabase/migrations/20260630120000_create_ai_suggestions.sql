-- AI pre-classifier staging (suggestions only — never writes classifications)

create table ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references transactions (id) on delete cascade,
  vendor_group_key text not null default '',
  entity_id uuid not null references entities (id) on delete restrict,
  entity_slug text not null,
  suggested_category_id uuid references categories (id) on delete set null,
  suggested_category_path text,
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  rationale text not null,
  model text not null,
  input_tokens int,
  output_tokens int,
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index ai_suggestions_current_transaction_idx
  on ai_suggestions (transaction_id)
  where is_current = true;

create index ai_suggestions_entity_created_idx
  on ai_suggestions (entity_id, created_at desc);

create index ai_suggestions_vendor_group_idx
  on ai_suggestions (vendor_group_key)
  where is_current = true;

alter table ai_suggestions enable row level security;

create policy "Authenticated users can read ai_suggestions"
  on ai_suggestions for select
  to authenticated
  using (true);

create policy "Authenticated users can insert ai_suggestions"
  on ai_suggestions for insert
  to authenticated
  with check (true);

create policy "Authenticated users can update ai_suggestions"
  on ai_suggestions for update
  to authenticated
  using (true)
  with check (true);
