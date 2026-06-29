-- WS-E TAX-11 — split Meals into explicit deductible-haircut buckets.
--
-- Per the overnight CPA/tax review, the meals & entertainment deduction haircut should be explicit
-- in the chart so the deductible portion is obvious at booking time:
--   - "Meals (50%)"        — standard business meals (IRC §274(n) 50% limit)
--   - "Meals (100%)"       — fully deductible meals (e.g. office snacks / employee events)
--   - "Entertainment (0%)" — entertainment, non-deductible since TCJA §274(a)
-- Seeded for the operating + rental entities (gbsl, keller, acaa-austin, pflugerville).
--
-- DESIGN DECISION (flagged for WS-F / Stage-3): all three are kind "expense" (default in
-- lib/category-kind.ts), INCLUDING "Entertainment (0%)" — NOT "non_deductible". Hundie is an
-- expense-CONTROL ledger: entertainment is real management spend you want on the rollup; the §274
-- 0% haircut is a tax-deduction concern that belongs in a durable `deductible_pct` column in
-- Stage-3, not in the kind. (Contrast: "Tax Penalty" → "non_deductible" is correct because the
-- review wants penalties fully off the deductible total.) The deductible % is encoded in the name
-- for now.
--
-- ADDITIVE / NON-DESTRUCTIVE: the existing "Meals & Entertainment" (GBSL) / "Meals & entertainment
-- (rental)" categories are left untouched; re-pointing booked rows is a Stage-2 operator step.

insert into categories (entity_id, name, full_path, is_active)
select e.id, v.name, v.full_path, true
from entities e
cross join (
  values
    ('Meals (50%)', 'Meals (50%)'),
    ('Meals (100%)', 'Meals (100%)'),
    ('Entertainment (0%)', 'Entertainment (0%)')
) as v(name, full_path)
where e.slug in ('gbsl', 'keller', 'acaa-austin', 'pflugerville')
on conflict (entity_id, full_path) do nothing;
