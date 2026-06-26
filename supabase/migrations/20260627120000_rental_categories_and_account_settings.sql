-- Schedule E rental category charts for Austin ACAA and Pflugerville

insert into categories (entity_id, name, full_path, is_active)
select e.id, v.name, v.full_path, true
from entities e
cross join (
  values
    ('Advertising & listing', 'Advertising & listing'),
    ('Mortgage interest', 'Mortgage interest'),
    ('Property taxes', 'Property taxes'),
    ('Insurance — rental property', 'Insurance — rental property'),
    ('Repairs & maintenance', 'Repairs & maintenance'),
    ('Utilities — rental', 'Utilities — rental'),
    ('HOA / property management', 'HOA / property management'),
    ('Supplies & cleaning', 'Supplies & cleaning'),
    ('Travel to property', 'Travel to property'),
    ('Landscaping & pest control', 'Landscaping & pest control'),
    ('Professional services (legal, CPA)', 'Professional services (legal, CPA)'),
    ('Depreciation (CPA)', 'Depreciation (CPA)'),
    ('→ Personal (mis-posted)', '→ Personal (mis-posted)'),
    ('→ GBSL business expense', '→ GBSL business expense'),
    ('Mixed / pending allocation', 'Mixed / pending allocation'),
    ('Mortgage principal payment', 'Mortgage principal payment'),
    ('Security deposit movement', 'Security deposit movement'),
    ('Refund / credit', 'Refund / credit')
) as v(name, full_path)
where e.slug in ('acaa-austin', 'pflugerville')
on conflict (entity_id, full_path) do nothing;

-- Allow authenticated users to manage account entity rules (ledger stays per-transaction)
create policy "Authenticated users can update accounts"
  on accounts for update
  to authenticated
  using (true)
  with check (true);

-- Fix Cap One Quicksilver date split for 2026 (was seeded as 2025)
update accounts
set date_rules = '[
  {"until":"2026-06-30","entity_slug":"gbsl"},
  {"from":"2026-07-01","entity_slug":"personal"}
]'::jsonb
where slug = 'cap-one-quicksilver-claudia';
