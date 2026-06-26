-- GBSL: non-expense transfer categories (excluded from expense totals in app)
insert into categories (entity_id, name, full_path, is_active)
select e.id, v.name, v.full_path, true
from entities e
cross join (
  values
    ('Credit card payment', 'Credit card payment'),
    ('Refund / credit', 'Refund / credit')
) as v(name, full_path)
where e.slug = 'gbsl'
on conflict (entity_id, full_path) do nothing;

-- Personal: credit card interest (non-deductible household expense)
insert into categories (entity_id, name, full_path, is_active)
select e.id, v.name, v.full_path, true
from entities e
cross join (
  values
    ('Credit card interest (non-deductible)', 'Credit card interest (non-deductible)')
) as v(name, full_path)
where e.slug = 'personal'
on conflict (entity_id, full_path) do nothing;

-- Rental entities: fees, CC interest, tenant meals
insert into categories (entity_id, name, full_path, is_active)
select e.id, v.name, v.full_path, true
from entities e
cross join (
  values
    ('Bank fees', 'Bank fees'),
    ('Interest expense (credit card)', 'Interest expense (credit card)'),
    ('Meals & entertainment (rental)', 'Meals & entertainment (rental)')
) as v(name, full_path)
where e.slug in ('acaa-austin', 'pflugerville')
on conflict (entity_id, full_path) do nothing;
