-- WS-F TAX-17 — canonical personal "Charitable contributions (Sch A)" + map.
--
-- FILE ONLY / STAGE-2. This is the Stage-2 reclass target for the mis-booked GBSL $54 (the data move
-- itself is Stage-2 operator work). kind=expense. Idempotent insert + guarded mapping UPDATE.

insert into categories (entity_id, name, full_path, kind, is_active)
select e.id, 'Charitable contributions (Sch A)', 'Charitable contributions (Sch A)', 'expense', true
from entities e
where e.slug = 'personal'
on conflict (entity_id, full_path) do nothing;

update categories c
set tax_form = 'sch_a', tax_line = 'Charitable contributions (Sch A)', updated_at = now()
from entities e
where c.entity_id = e.id and e.slug = 'personal'
  and c.full_path = 'Charitable contributions (Sch A)' and c.tax_form is null;
-- NOTE: the pre-existing unsuffixed personal 'Charitable contributions' is also mapped to sch_a in
-- TAX-03. Minor duplication; deduping the two (and re-pointing rows) is a Stage-2 operator step.
