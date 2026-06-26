-- Quicksilver (cap-one-quicksilver-claudia): GBSL through 2026-06-30, Personal from 2026-07-01.
-- Operator confirmed 2026-06-26. Prior seed used 2025 boundaries, mis-booking Jul 2025–Jun 2026 to Personal.

update accounts
set date_rules = '[
  {"until":"2026-06-30","entity_slug":"gbsl"},
  {"from":"2026-07-01","entity_slug":"personal"}
]'::jsonb,
    updated_at = now()
where slug = 'cap-one-quicksilver-claudia';

-- Re-assign entity on mis-booked window; clear category when it belongs to Personal chart.
update classifications c
set entity_id = gbsl.id,
    category_id = case
      when cat.entity_id = gbsl.id then c.category_id
      else null
    end,
    classified_by = coalesce(nullif(c.classified_by, ''), 'quicksilver-date-rule-fix'),
    classified_at = now()
from transactions t
join accounts a on a.id = t.account_id and a.slug = 'cap-one-quicksilver-claudia'
join entities personal on personal.slug = 'personal'
join entities gbsl on gbsl.slug = 'gbsl'
left join categories cat on cat.id = c.category_id
where c.transaction_id = t.id
  and c.entity_id = personal.id
  and t.transaction_date >= '2025-07-01'
  and t.transaction_date < '2026-07-01';
