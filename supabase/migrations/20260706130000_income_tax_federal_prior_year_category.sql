-- Income tax — federal (prior year) — Personal chart.
--
-- Separates a prior-year federal balance-due / settlement payment from current-year 1040-ES
-- estimates (which stay in "Estimated tax payments — federal"). Both are real cash out and both
-- are non-deductible, but keeping them apart makes per-tax-year reconciliation honest.
--
-- kind=expense: a real outflow tracked as spend, mirroring "Estimated tax payments — federal".
-- tax_form=none: federal income tax is never deductible on the federal return (it is a payment).
-- Em-dash is U+2014 to match the personal chart. Idempotent insert + guarded tax mapping.

insert into categories (entity_id, name, full_path, kind, is_active)
select e.id, 'Income tax — federal (prior year)', 'Income tax — federal (prior year)', 'expense', true
from entities e where e.slug = 'personal'
on conflict (entity_id, full_path) do nothing;

update categories c
set tax_form = 'none', tax_line = null, updated_at = now()
from entities e
where c.entity_id = e.id and e.slug = 'personal'
  and c.full_path = 'Income tax — federal (prior year)'
  and c.tax_form is null;
