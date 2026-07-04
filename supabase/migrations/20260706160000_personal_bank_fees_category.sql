-- Bank Fees — Personal chart.
--
-- No standalone bank/card-fee bucket previously existed on Personal (only
-- "Credit card interest (non-deductible)", which is for interest, not fees). This mirrors the
-- "Bank Fees" / "Bank fees" categories already on GBSL/Keller/rentals. kind=expense (real cash out);
-- tax_form=none (personal bank/card fees are not deductible). Idempotent.

insert into categories (entity_id, name, full_path, kind, is_active)
select e.id, 'Bank Fees', 'Bank Fees', 'expense', true
from entities e where e.slug = 'personal'
on conflict (entity_id, full_path) do nothing;

update categories c
set tax_form = 'none', tax_line = null, updated_at = now()
from entities e
where c.entity_id = e.id and e.slug = 'personal'
  and c.full_path = 'Bank Fees'
  and c.tax_form is null;
