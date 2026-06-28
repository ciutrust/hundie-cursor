-- WS-E ACCT-08 / TAX-06 — GBSL vehicle-loan interest/principal split.
--
-- The GBSL "Ford Motor Credit - F150" category (imported from QuickBooks) lumps the whole vehicle
-- loan payment together. Per the overnight CPA/tax review, the principal portion is a balance-sheet
-- LIABILITY paydown (not an expense) and only the interest is deductible. This seeds an
-- interest(expense) + principal(liability) pair as QB-style subaccounts of the combined loan,
-- mirroring the existing "Auto Expense:Fuel" colon-nesting convention (scripts/.qb-import-sql).
--
-- KIND MAP (lib/category-kind.ts): "Ford Motor Credit - F150:Principal" → "liability" (off the
-- P&L); "Ford Motor Credit - F150:Interest" falls through to the default "expense" (deductible).
--
-- ADDITIVE / NON-DESTRUCTIVE: the parent "Ford Motor Credit - F150" keeps its booked rows
-- untouched; re-pointing them onto the split touches `classifications` and is a Stage-2 operator
-- step. parent_id is resolved from the existing parent row (GBSL entity).

insert into categories (entity_id, name, full_path, parent_id, is_active)
select e.id, v.name, v.full_path,
  (select c.id from categories c
   where c.entity_id = e.id and c.full_path = 'Ford Motor Credit - F150'),
  true
from entities e
cross join (
  values
    ('Interest', 'Ford Motor Credit - F150:Interest'),
    ('Principal', 'Ford Motor Credit - F150:Principal')
) as v(name, full_path)
where e.slug = 'gbsl'
on conflict (entity_id, full_path) do nothing;
