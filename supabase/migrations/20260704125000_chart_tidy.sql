-- WS-E ACCT-15 — chart-of-accounts tidy: dedupe, reclass, and a Schedule-E split.
--
-- Three guarded, idempotent, additive operations per the overnight CPA/tax review. No drops; every
-- deactivation is guarded so a category that actually holds booked rows is never hidden. Re-pointing
-- of booked rows onto the reclass/split targets touches `classifications` and is a Stage-2 step.

-- 1. Dedupe GBSL owner distribution. 20260702160000 seeded a flat "Owner Distribution" for gbsl,
--    but the QB import (scripts/.qb-import-sql/01-categories.sql) put the real rows under the
--    QB-native "Owners Equity:Owner Distribution". Deactivate the redundant flat twin ONLY if it
--    holds no classifications (so this is a safe no-op when it has data). Both are kind "funding",
--    so the rollup is unaffected either way. The flat "Owner Contribution" has no colon twin — keep it.
update categories
set is_active = false, updated_at = now()
where entity_id = (select id from entities where slug = 'gbsl')
  and full_path = 'Owner Distribution'
  and not exists (select 1 from classifications cl where cl.category_id = categories.id);

-- 2. Reclass the Keller "Medical Expenses" business category. Owner medical is a personal draw, not
--    a deductible Keller expense. Seed the funding reclass targets (kind "funding", off the P&L)…
insert into categories (entity_id, name, full_path, is_active)
select e.id, v.name, v.full_path, true
from entities e
cross join (
  values
    ('Owner Distribution', 'Owner Distribution'),
    ('Owner Contribution', 'Owner Contribution')
) as v(name, full_path)
where e.slug = 'keller'
on conflict (entity_id, full_path) do nothing;

--    …then deactivate "Medical Expenses" for keller, guarded by EXISTS so it is a safe no-op on a
--    fresh DB (the category lives in the live DB, not in these migrations) and never hides rows.
update categories
set is_active = false, updated_at = now()
where entity_id = (select id from entities where slug = 'keller')
  and full_path = 'Medical Expenses'
  and not exists (select 1 from classifications cl where cl.category_id = categories.id);

-- 3. Split the rental "Supplies & cleaning" into the two Schedule-E lines: "Supplies" (Sch-E L15)
--    and "Cleaning & maintenance" (Sch-E L7). Both kind "expense". Seed the split…
insert into categories (entity_id, name, full_path, is_active)
select e.id, v.name, v.full_path, true
from entities e
cross join (
  values
    ('Supplies', 'Supplies'),
    ('Cleaning & maintenance', 'Cleaning & maintenance')
) as v(name, full_path)
where e.slug in ('acaa-austin', 'pflugerville')
on conflict (entity_id, full_path) do nothing;

--    …then deactivate "Supplies & cleaning" for the rentals, guarded so it never hides booked rows.
update categories
set is_active = false, updated_at = now()
where entity_id in (select id from entities where slug in ('acaa-austin', 'pflugerville'))
  and full_path = 'Supplies & cleaning'
  and not exists (select 1 from classifications cl where cl.category_id = categories.id);
