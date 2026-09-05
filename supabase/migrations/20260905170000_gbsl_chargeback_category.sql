-- Chargeback — GBSL chart.
--
-- Member/customer disputes a card charge (issuer pullback). Distinct from a voluntary
-- "Refund / credit". Counts as an operating expense on the P&L (default expense kind).
-- Idempotent.

insert into categories (entity_id, name, full_path, kind, is_active)
select e.id, 'Chargeback', 'Chargeback', 'expense', true
from entities e where e.slug = 'gbsl'
on conflict (entity_id, full_path) do nothing;
