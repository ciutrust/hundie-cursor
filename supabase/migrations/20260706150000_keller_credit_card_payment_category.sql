-- Credit card payment — Keller chart.
--
-- Checking → business-card payoffs (e.g., WF Signify Business Cash Card) are money movement, NOT
-- an expense. "Credit card payment" is already a recognized transfer path in lib/category-kind.ts
-- (TRANSFER_PATHS), so this row is treated as kind=transfer at runtime and excluded from expense
-- rollups — matching GBSL/Personal. kind=transfer set on the column too. Idempotent.

insert into categories (entity_id, name, full_path, kind, is_active)
select e.id, 'Credit card payment', 'Credit card payment', 'transfer', true
from entities e where e.slug = 'keller'
on conflict (entity_id, full_path) do nothing;
