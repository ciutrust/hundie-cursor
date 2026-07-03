-- C8: transaction-FIELD audit trail (amount / date / description changes).
--
-- Classification changes are already audited via classification_history; transaction FIELD changes
-- are NOT. A closed month can be silently reshaped by Plaid `modified` events or bulk commits with no
-- record. This adds an AUDIT-ONLY transaction_history table + trigger that RECORDS money-affecting
-- field changes so the close pages can surface "changed since close". It is NON-BLOCKING: it never
-- rejects a write (Plaid legitimately re-reports settled amounts; write-time blocking would need a
-- period_closes table to persist close timestamps, which is out of scope).
--
-- IDEMPOTENT: safe to re-run under scripts/stage2/apply-migrations.mjs (create ... if not exists,
-- create or replace function, drop trigger if exists, drop policy if exists).

create table if not exists transaction_history (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references transactions (id) on delete cascade,
  previous_amount numeric,
  new_amount numeric,
  previous_transaction_date date,
  new_transaction_date date,
  previous_description text,
  new_description text,
  changed_at timestamptz not null default now(),
  -- Defaults to 'system': no `app.actor` GUC is set on any write path today. Populating a real actor
  -- is future work (see the trigger's coalesce(current_setting('app.actor', ...))).
  changed_by text not null default 'system'
);

-- T6 (review): index the audit FK + the changed_at scan column so the trail stays cheap to query.
create index if not exists transaction_history_transaction_id_idx
  on transaction_history (transaction_id);
create index if not exists transaction_history_changed_at_idx
  on transaction_history (changed_at);

create or replace function log_transaction_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- `is distinct from` (null-safe) guards mean a plaid_removed_at-only update (Batch B/C20) does NOT
  -- log — only a change to a money-affecting field (amount / transaction_date / description) does.
  if old.amount is distinct from new.amount
     or old.transaction_date is distinct from new.transaction_date
     or old.description is distinct from new.description then
    insert into transaction_history (
      transaction_id,
      previous_amount,
      new_amount,
      previous_transaction_date,
      new_transaction_date,
      previous_description,
      new_description,
      changed_by
    ) values (
      new.id,
      old.amount,
      new.amount,
      old.transaction_date,
      new.transaction_date,
      old.description,
      new.description,
      -- No app.actor GUC is set today, so this resolves to 'system'. Future refinement: set
      -- `SET LOCAL app.actor = '<user>'` in the write transaction to attribute the change.
      coalesce(nullif(current_setting('app.actor', true), ''), 'system')
    );
  end if;

  return new;
end;
$$;

drop trigger if exists transactions_history_trigger on transactions;
create trigger transactions_history_trigger
  after update on transactions
  for each row
  execute function log_transaction_change();

alter table transaction_history enable row level security;

-- Authenticated-only SELECT. This is TIGHTER than classification_history (which is anon-readable) —
-- intentional: an audit trail of money changes is more sensitive, and the close pages read it as an
-- authenticated user. There is NO insert/update/delete policy: writes happen ONLY via the SECURITY
-- DEFINER trigger above (which bypasses RLS); the app has no direct write path to this table.
drop policy if exists "Authenticated can read transaction_history" on transaction_history;
create policy "Authenticated can read transaction_history"
  on transaction_history for select
  to authenticated
  using (true);
