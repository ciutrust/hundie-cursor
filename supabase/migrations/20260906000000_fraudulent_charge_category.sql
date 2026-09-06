-- Fraudulent charge — Personal, GBSL, Keller, Austin ACAA, Pflugerville.
--
-- Unauthorized / stolen-card charges (expense on the P&L). Pair with "Refund / credit" when the
-- issuer returns the money. Distinct from GBSL "Chargeback" (member disputes against you).
-- Idempotent.

insert into categories (entity_id, name, full_path, kind, is_active)
select e.id, 'Fraudulent charge', 'Fraudulent charge', 'expense', true
from entities e
where e.slug in ('personal', 'gbsl', 'keller', 'acaa-austin', 'pflugerville')
on conflict (entity_id, full_path) do nothing;
