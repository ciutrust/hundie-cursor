-- Keller: non-expense refund category (C2 card import backfill)
insert into categories (entity_id, name, full_path, is_active)
select e.id, v.name, v.full_path, true
from entities e
cross join (
  values
    ('Refund / credit', 'Refund / credit')
) as v(name, full_path)
where e.slug = 'keller'
on conflict (entity_id, full_path) do nothing;
