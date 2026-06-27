-- Personal "Legal & professional fees" category (e.g. trust-formation legal/consulting).
-- Created in prod 2026-06-27 while classifying the big-ticket backlog; this keeps a fresh DB in sync.

insert into categories (entity_id, name, full_path, is_active)
select id, 'Legal & professional fees', 'Legal & professional fees', true
from entities
where slug = 'personal'
  and not exists (
    select 1 from categories c
    where c.entity_id = entities.id and c.full_path = 'Legal & professional fees'
  );
