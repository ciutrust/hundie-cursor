-- Phase 2 of income capture (docs/INCOME_CAPTURE_PLAN.md): income / funding / capital categories.
-- Category "kind" is assigned in code (lib/category-kind.ts); these are the rows to classify into.
-- Idempotent: each row is inserted only if it doesn't already exist for the entity.

insert into categories (entity_id, name, full_path, is_active)
select e.id, v.name, v.name, true
from (values
  ('keller', 'Membership revenue'),
  ('personal', 'Salary & wages'),
  ('personal', 'Investment proceeds'),
  ('personal', 'Interest income'),
  ('personal', 'Other income'),
  ('acaa-austin', 'Rent income'),
  ('pflugerville', 'Rent income'),
  ('personal', 'Owner Contribution'),
  ('personal', 'Owner Distribution'),
  ('gbsl', 'Owner Contribution'),
  ('gbsl', 'Owner Distribution'),
  ('keller', 'Leasehold improvements'),
  ('keller', 'Tenant improvement allowance'),
  ('acaa-austin', 'Property purchase')
) as v(slug, name)
join entities e on e.slug = v.slug
where not exists (
  select 1 from categories c
  where c.entity_id = e.id and c.full_path = v.name
);
