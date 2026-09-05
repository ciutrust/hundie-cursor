-- Chargeback — GBSL chart.
--
-- Member/customer disputes a card charge (issuer pullback). Distinct from a voluntary
-- "Refund / credit". Money movement, not P&L — kind=transfer matches Refund / credit and
-- is recognized in lib/category-kind.ts (TRANSFER_PATHS). Idempotent.

insert into categories (entity_id, name, full_path, kind, is_active)
select e.id, 'Chargeback', 'Chargeback', 'transfer', true
from entities e where e.slug = 'gbsl'
on conflict (entity_id, full_path) do nothing;
