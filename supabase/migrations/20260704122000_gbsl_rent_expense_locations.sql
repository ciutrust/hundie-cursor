-- WS-E ACCT-10 — split the GBSL "Rent Expense" into per-location subaccounts.
--
-- Today every GBSL lease lands in one flat "Rent Expense" category, which (a) made the old
-- intercompany scan over-broad — it flagged ALL rent, not just the 136 Anita intercompany lease —
-- and (b) hid which landlord each payment went to. Per the overnight CPA/tax review, this seeds the
-- named per-location subaccounts so the 136 Anita lease can be isolated (it moves to its own
-- dedicated intercompany category in 20260704123000, so it is intentionally NOT one of these).
--
-- All subaccounts are ordinary "expense" kind (default in lib/category-kind.ts). Names are from the
-- overnight review; QB-style colon-nesting under the existing "Rent Expense" parent (GBSL entity).
--
-- ADDITIVE / NON-DESTRUCTIVE: the parent "Rent Expense" keeps its booked rows; re-pointing them
-- onto the per-location subaccounts touches `classifications` and is a Stage-2 operator step.

insert into categories (entity_id, name, full_path, parent_id, is_active)
select e.id, v.name, v.full_path,
  (select c.id from categories c
   where c.entity_id = e.id and c.full_path = 'Rent Expense'),
  true
from entities e
cross join (
  values
    ('US Property Trust', 'Rent Expense:US Property Trust'),
    ('Kobalt Investment', 'Rent Expense:Kobalt Investment'),
    ('CubeSmart storage', 'Rent Expense:CubeSmart storage'),
    ('Three77 Park', 'Rent Expense:Three77 Park')
) as v(name, full_path)
where e.slug = 'gbsl'
on conflict (entity_id, full_path) do nothing;
