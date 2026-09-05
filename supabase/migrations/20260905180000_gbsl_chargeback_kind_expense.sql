-- Fix: Chargeback was seeded as transfer; it is an expense (member retracts a charge).
-- Safe if the insert migration already used kind=expense.

update categories c
set kind = 'expense'
from entities e
where c.entity_id = e.id
  and e.slug = 'gbsl'
  and c.full_path = 'Chargeback'
  and c.kind is distinct from 'expense';
