-- Classification audit trail + authenticated write access for review UI

create table classification_history (
  id uuid primary key default gen_random_uuid(),
  classification_id uuid not null references classifications (id) on delete cascade,
  transaction_id uuid not null references transactions (id) on delete cascade,
  previous_entity_id uuid references entities (id) on delete set null,
  previous_category_id uuid references categories (id) on delete set null,
  new_entity_id uuid not null references entities (id) on delete restrict,
  new_category_id uuid references categories (id) on delete set null,
  changed_at timestamptz not null default now(),
  changed_by text not null
);

create index classification_history_classification_id_idx
  on classification_history (classification_id);

create index classification_history_transaction_id_idx
  on classification_history (transaction_id);

create or replace function log_classification_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.entity_id is distinct from new.entity_id
     or old.category_id is distinct from new.category_id then
    insert into classification_history (
      classification_id,
      transaction_id,
      previous_entity_id,
      previous_category_id,
      new_entity_id,
      new_category_id,
      changed_by
    ) values (
      new.id,
      new.transaction_id,
      old.entity_id,
      old.category_id,
      new.entity_id,
      new.category_id,
      new.classified_by
    );
  end if;

  return new;
end;
$$;

create trigger classifications_history_trigger
  after update on classifications
  for each row
  execute function log_classification_change();

alter table classification_history enable row level security;

create policy "Anyone can read classification_history"
  on classification_history for select
  to anon, authenticated
  using (true);

create policy "Authenticated users can update classifications"
  on classifications for update
  to authenticated
  using (true)
  with check (true);
