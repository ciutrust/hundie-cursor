-- Stage 2 Phase 2: snapshot the live classification training signal into qb_training_expenses (a KEEP table)
-- BEFORE the Phase-4 wipe, so re-classification suggestions survive. Idempotent (ON CONFLICT DO NOTHING).
-- import_batch_id is set NULL so these rows are immune to TRUNCATE ... import_batches CASCADE.
-- Applied via Supabase MCP execute_sql (no DATABASE_URL / CLI needed). Re-runnable.

insert into qb_training_expenses
  (entity_id, category_id, import_batch_id, source_account, transaction_date,
   transaction_type, transaction_num, vendor_name, description, category_name, amount, import_hash)
select cl.entity_id, cl.category_id, null, a.display_name, t.transaction_date,
       'hundie_snapshot', null, t.vendor, t.description, c.full_path, t.amount,
       'hundie_snapshot:' || t.id::text
from classifications cl
join transactions t on t.id = cl.transaction_id
join categories c   on c.id = cl.category_id
join accounts a     on a.id = t.account_id
where cl.category_id is not null
on conflict (entity_id, import_hash) do nothing;
