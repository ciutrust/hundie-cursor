-- WS-G ACCT-06 / TAX-07 — payee/vendor master + alias collapse for 1099-NEC aggregation.
--
-- FILE ONLY / STAGE-2: this migration is NOT applied at runtime now. It is an additive Stage-1
-- schema foundation; an operator applies the 20260706* batch at Stage 2. No app/lib/script reads
-- these tables yet.
--
-- payees is the canonical vendor/person master. payee_aliases collapses name-order variants of the
-- same person ("Jane Q Smith" / "Smith, Jane") onto one payee so a Form 1099-NEC report can sum every
-- payment to that person regardless of how the source described them. entity_id is nullable so a payee
-- can be global (paid by several entities) or entity-scoped; normalized_key / normalized_alias are the
-- case/whitespace/order-folded match keys the app computes (indexed, not unique — global vs
-- entity-scoped rows may legitimately share a key).
--
-- SECURITY: RLS enabled, authenticated-only (matches the ledger lockdown since 20260629140000 — the
-- browser publishable/anon key cannot read these). Mirrors the ai_suggestions policy set
-- (select / insert / update for authenticated; deletes go through the service-role client).

create table if not exists payees (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid references entities (id) on delete set null,
  display_name text not null,
  normalized_key text not null,
  tin text,
  w9_on_file boolean not null default false,
  is_1099_vendor boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists payees_entity_id_idx on payees (entity_id);
create index if not exists payees_normalized_key_idx on payees (normalized_key);

create table if not exists payee_aliases (
  id uuid primary key default gen_random_uuid(),
  payee_id uuid not null references payees (id) on delete cascade,
  alias text not null,
  normalized_alias text not null,
  created_at timestamptz not null default now()
);

create index if not exists payee_aliases_payee_id_idx on payee_aliases (payee_id);
create index if not exists payee_aliases_normalized_alias_idx on payee_aliases (normalized_alias);

alter table payees enable row level security;
alter table payee_aliases enable row level security;

drop policy if exists "Authenticated users can read payees" on payees;
create policy "Authenticated users can read payees"
  on payees for select
  to authenticated
  using (true);

drop policy if exists "Authenticated users can insert payees" on payees;
create policy "Authenticated users can insert payees"
  on payees for insert
  to authenticated
  with check (true);

drop policy if exists "Authenticated users can update payees" on payees;
create policy "Authenticated users can update payees"
  on payees for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "Authenticated users can read payee_aliases" on payee_aliases;
create policy "Authenticated users can read payee_aliases"
  on payee_aliases for select
  to authenticated
  using (true);

drop policy if exists "Authenticated users can insert payee_aliases" on payee_aliases;
create policy "Authenticated users can insert payee_aliases"
  on payee_aliases for insert
  to authenticated
  with check (true);

drop policy if exists "Authenticated users can update payee_aliases" on payee_aliases;
create policy "Authenticated users can update payee_aliases"
  on payee_aliases for update
  to authenticated
  using (true)
  with check (true);
