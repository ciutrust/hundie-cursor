-- WS-F TAX-15 — §469 self-rental flag.
--
-- FILE ONLY / STAGE-2: a links table (not a boolean) so the payer↔owner PAIR + property is captured.
-- RLS authenticated-only read (this is reference data; rows are seeded/edited via the service-role
-- client, matching the read-only-from-the-app convention for ledger reference tables).

create table if not exists self_rental_links (
  id uuid primary key default gen_random_uuid(),
  payer_entity_id uuid not null references entities (id) on delete cascade,
  owner_entity_id uuid not null references entities (id) on delete cascade,
  property_label text not null,
  note text,
  created_at timestamptz not null default now(),
  unique (payer_entity_id, owner_entity_id, property_label)
);

alter table self_rental_links enable row level security;

drop policy if exists "Authenticated users can read self_rental_links" on self_rental_links;
create policy "Authenticated users can read self_rental_links"
  on self_rental_links for select
  to authenticated
  using (true);

-- Seed the GBSL (operating, materially-participated) ↔ Austin ACAA (owns 136 Anita) self-rental.
insert into self_rental_links (payer_entity_id, owner_entity_id, property_label, note)
select p.id, o.id, '136 Anita',
  '§469 self-rental: GBSL leases 136 Anita from Austin ACAA House LLC. Net rental INCOME is '
  || 'recharacterized as non-passive (cannot absorb other passive income); net losses stay passive. '
  || 'Surface at tax time. Paired with the GBSL "Intercompany — 136 Anita" expense leg.'
from entities p, entities o
where p.slug = 'gbsl' and o.slug = 'acaa-austin'
on conflict (payer_entity_id, owner_entity_id, property_label) do nothing;
