-- "Credit card rewards / cash back" category for every classifiable entity. Cash-back is a rebate
-- (kind = transfer in lib/category-kind.ts), excluded from both income and expense. See INCOME_CAPTURE_PLAN.md.
-- Idempotent.

insert into categories (entity_id, name, full_path, is_active)
select e.id, 'Credit card rewards / cash back', 'Credit card rewards / cash back', true
from entities e
where e.is_classifiable = true
  and not exists (
    select 1 from categories c
    where c.entity_id = e.id and c.full_path = 'Credit card rewards / cash back'
  );
