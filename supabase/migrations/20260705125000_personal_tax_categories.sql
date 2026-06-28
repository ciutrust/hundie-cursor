-- WS-F TAX-16 — missing personal tax buckets, with inline tax mapping (columns exist from TAX-03).
--
-- FILE ONLY / STAGE-2. kind=expense (money-out). Em-dashes are U+2014 to match the personal chart.
-- Idempotent insert + a guarded mapping UPDATE (so a pre-existing row still gets mapped without
-- clobbering a CPA edit).

insert into categories (entity_id, name, full_path, kind, is_active)
select e.id, v.name, v.full_path, 'expense', true
from entities e
cross join (values
  ('HSA contributions', 'HSA contributions'),
  ('529 contributions', '529 contributions'),
  ('Estimated tax payments — federal', 'Estimated tax payments — federal'),
  ('Estimated tax payments — state', 'Estimated tax payments — state'),
  ('Retirement contributions (IRA/SEP/Solo-401k)', 'Retirement contributions (IRA/SEP/Solo-401k)'),
  ('Home office', 'Home office'),
  ('Dependent care (Form 2441)', 'Dependent care (Form 2441)'),
  ('EV / energy-efficiency credits', 'EV / energy-efficiency credits')
) as v(name, full_path)
where e.slug = 'personal'
on conflict (entity_id, full_path) do nothing;

-- Map only the CLEAR ones. The rest stay NULL (CPA). Guard on tax_form IS NULL = idempotent.
update categories c
set tax_form = m.tax_form, tax_line = m.tax_line, updated_at = now()
from (values
  ('HSA contributions','form_8889','Form 8889 (above-the-line)'),
  ('Dependent care (Form 2441)','form_2441','Form 2441 (dependent care credit)'),
  ('529 contributions','none',null),                          -- not federally deductible; TX has no state income tax
  ('Estimated tax payments — federal','none',null)            -- federal income tax is never deductible (it is a payment)
) as m(full_path, tax_form, tax_line)
join entities e on e.slug = 'personal'
where c.entity_id = e.id and c.full_path = m.full_path and c.tax_form is null;
-- Left NULL (ambiguous): 'Estimated tax payments — state' (SALT only in an income-tax state — $0 for TX),
-- 'Retirement contributions (IRA/SEP/Solo-401k)' (plan-type dependent, likely Schedule 1),
-- 'Home office' (Form 8829 only if tied to a Sch C trade), 'EV / energy-efficiency credits'
-- (Form 8936 EV vs Form 5695 energy — CPA splits).
--
-- 'Medical (Sch A)' from the ticket is intentionally NOT seeded: the existing personal 'Medical & dental'
-- already covers it and is mapped to sch_a in TAX-03 (avoids a duplicate category).
