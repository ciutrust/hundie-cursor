-- Single-payment Mortgage / HELOC categories (expense-control, not a tax split).
--
-- Hundie is an expense-control app: it tracks the FULL mortgage/HELOC payment as one
-- counted "expense" for management. The principal/interest split and tax treatment
-- happen in QuickBooks Online, not here. So these are normal (counted) expense
-- categories — intentionally NOT in the non-expense exclusion list
-- (lib/category-expense.ts), unlike "Mortgage principal payment".
--
-- Entities: Pflugerville (M&T) and Austin ACAA / 136 Anita (SPS) rentals + Personal
-- (primary-residence mortgage / HELOC, e.g. Chase, FFIN).

insert into categories (entity_id, name, full_path, is_active)
select e.id, v.name, v.full_path, true
from entities e
cross join (
  values
    ('Mortgage payment', 'Mortgage payment'),
    ('HELOC payment', 'HELOC payment')
) as v(name, full_path)
where e.slug in ('pflugerville', 'acaa-austin', 'personal')
on conflict (entity_id, full_path) do nothing;
