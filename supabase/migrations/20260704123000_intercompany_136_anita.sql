-- WS-E ACCT-07 — dedicated "136 Anita" intercompany lease category, booked on BOTH sides.
--
-- GBSL pays a lease to Austin ACAA House LLC (which owns the 136 Anita rental). On separate-entity
-- books GBSL deducts the rent (expense) and ACAA reports the rent (income); the two NET TO ZERO on
-- consolidation. Today the GBSL leg was buried in the flat "Rent Expense" and the ACAA leg had no
-- home, so the lease could be double-counted. This seeds a dedicated category on each side so the
-- pair is isolatable and the intercompany scan (lib/queries/intercompany.ts) can match + net them.
--
-- TWO DISTINCT path strings are required, not one shared string: categoryKind is path-only /
-- entity-agnostic, so a single path cannot be "expense" on the GBSL side and "income" on the ACAA
-- side. Hence the "(income)" suffix on the ACAA leg.
--   - gbsl "Intercompany — 136 Anita"          → "expense" (default; real deductible GBSL rent)
--   - acaa-austin "Intercompany — 136 Anita (income)" → "income" (in INCOME_PATHS)
-- Em-dash is U+2014 with surrounding spaces, matching "Intercompany — pending" — the kind map and
-- the categories.kind backfill normalize on the same character, so they stay byte-identical.
--
-- ADDITIVE / NON-DESTRUCTIVE: re-pointing existing GBSL/ACAA lease rows onto these categories
-- touches `classifications` and is a Stage-2 operator step.

-- GBSL expense leg (lease paid to ACAA).
insert into categories (entity_id, name, full_path, is_active)
select e.id, v.name, v.full_path, true
from entities e
cross join (
  values
    ('Intercompany — 136 Anita', 'Intercompany — 136 Anita')
) as v(name, full_path)
where e.slug = 'gbsl'
on conflict (entity_id, full_path) do nothing;

-- Austin ACAA income leg (rent received from GBSL).
insert into categories (entity_id, name, full_path, is_active)
select e.id, v.name, v.full_path, true
from entities e
cross join (
  values
    ('Intercompany — 136 Anita (income)', 'Intercompany — 136 Anita (income)')
) as v(name, full_path)
where e.slug = 'acaa-austin'
on conflict (entity_id, full_path) do nothing;
