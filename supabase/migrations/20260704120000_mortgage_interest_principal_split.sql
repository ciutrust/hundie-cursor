-- WS-E ACCT-11 / TAX-02 — mortgage interest/principal split for the non-QBO entities.
--
-- Today the full mortgage payment is booked under a single "Mortgage payment" category and counts
-- as a deductible operating expense. Per the overnight CPA/tax review, the principal portion is a
-- balance-sheet LIABILITY paydown, not an expense, and only the interest is deductible. This
-- migration re-exposes an interest(expense) + principal(liability) pair so the split can be booked.
--
-- 20260702140000 hid EVERY path `ilike 'Mortgage principal%' OR 'Mortgage interest%'`, which also
-- hid the deductible rental "Mortgage interest" and personal "Mortgage interest — primary home"
-- lines (collateral damage). This re-activates them and the principal lines.
--
-- KIND MAP (lib/category-kind.ts): "Mortgage principal payment" and "Mortgage principal — primary
-- home" → "liability" (off the P&L); "Mortgage interest" / "Mortgage interest — primary home" stay
-- "expense" (deductible). Em-dash is U+2014 to match the existing personal-chart convention.
--
-- ADDITIVE / NON-DESTRUCTIVE: re-activations are guarded UPDATEs (no drops); the single
-- "Mortgage payment" / "HELOC payment" categories are left untouched. Re-pointing booked rows from
-- "Mortgage payment" onto the split pair touches `classifications` and is a Stage-2 operator step.

-- Re-activate the split categories that 20260702140000 over-hid (rentals: interest + principal).
update categories
set is_active = true, updated_at = now()
where full_path in ('Mortgage interest', 'Mortgage principal payment')
  and entity_id in (select id from entities where slug in ('acaa-austin', 'pflugerville'));

-- Re-activate the personal primary-residence mortgage interest line (deductible — collateral damage).
update categories
set is_active = true, updated_at = now()
where full_path = 'Mortgage interest — primary home'
  and entity_id in (select id from entities where slug = 'personal');

-- Seed the missing personal primary-residence principal line (new — liability kind).
insert into categories (entity_id, name, full_path, is_active)
select e.id, v.name, v.full_path, true
from entities e
cross join (
  values
    ('Mortgage principal — primary home', 'Mortgage principal — primary home')
) as v(name, full_path)
where e.slug = 'personal'
on conflict (entity_id, full_path) do nothing;
