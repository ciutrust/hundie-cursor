-- Job W2 Expenses — reimbursed W2 employer business travel (Egencia / Navan).
--
-- kind=transfer: this is a REIMBURSABLE wash, not personal spend — money fronted on a personal card
-- and paid back by the employer. Tagging the reimbursement the same way nets it to zero. Runtime
-- authority for kind is lib/category-kind.ts (TRANSFER_PATHS); this persists the same kind on the
-- column for the Stage-2 switchover + SQL-side rollups, mirroring 20260704190000.
--
-- tax_form=none: reimbursed W2 travel under an accountable plan is neither income nor deductible;
-- unreimbursed W2 employee business expenses are non-deductible federally post-TCJA anyway. So there
-- is no personal tax line — this category exists purely for clean expense tracking.
--
-- Idempotent insert (personal chart only) + guarded tax mapping so a pre-existing row is not clobbered.

insert into categories (entity_id, name, full_path, kind, is_active)
select e.id, 'Job W2 Expenses', 'Job W2 Expenses', 'transfer', true
from entities e
where e.slug = 'personal'
on conflict (entity_id, full_path) do nothing;

update categories c
set tax_form = 'none', tax_line = null, updated_at = now()
from entities e
where c.entity_id = e.id
  and e.slug = 'personal'
  and c.full_path = 'Job W2 Expenses'
  and c.tax_form is null;
