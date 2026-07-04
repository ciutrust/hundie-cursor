-- Phone & Internet — Keller chart.
--
-- Keller previously had no telecom category, so Verizon Business (ACHMA VISB) charges landed in
-- "Ask My Accountant" and "Utilities Expense". This mirrors GBSL's existing "Phone & Internet"
-- category so the two gyms are comparable and phone stays out of true utilities (electric/gas/water).
-- kind=expense (deductible business expense; business-schedule mapping handled in QBO). Idempotent.

insert into categories (entity_id, name, full_path, kind, is_active)
select e.id, 'Phone & Internet', 'Phone & Internet', 'expense', true
from entities e where e.slug = 'keller'
on conflict (entity_id, full_path) do nothing;
