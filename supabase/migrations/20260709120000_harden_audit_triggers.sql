-- S2 + S8: harden the two SECURITY DEFINER audit triggers.
--
-- S2 (audit-trail integrity): the classification trigger copied `new.classified_by` — a column any
-- aal1 PostgREST write can set to anything (e.g. 'import') — straight into the audit trail. Derive
-- `changed_by` from the REAL authenticated identity (JWT email) instead, falling back to the
-- app-set provenance for service-role/import writes (no JWT email). This leaves the app's own
-- authenticated writers and the service-role bulk committer behaviorally unchanged (they already
-- write the user email), but a forged classified_by can no longer spoof the trail.
--
-- S8 (grant hygiene): both trigger functions are needlessly EXECUTE-able by anon/authenticated via
-- /rest/v1/rpc/*. Revoke it — triggers still fire (they run as the definer regardless of EXECUTE).
--
-- IDEMPOTENT: create-or-replace + revoke are safe to re-run.

create or replace function log_classification_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.entity_id is distinct from new.entity_id
     or old.category_id is distinct from new.category_id then
    insert into classification_history (
      classification_id,
      transaction_id,
      previous_entity_id,
      previous_category_id,
      new_entity_id,
      new_category_id,
      changed_by
    ) values (
      new.id,
      new.transaction_id,
      old.entity_id,
      old.category_id,
      new.entity_id,
      new.category_id,
      -- S2: the authenticated identity, not the client-controlled classified_by column. Service-role
      -- / import writes have no JWT email → fall back to the app-set provenance.
      coalesce(nullif(auth.jwt() ->> 'email', ''), new.classified_by)
    );
  end if;

  return new;
end;
$$;

create or replace function log_transaction_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
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
      -- S2: prefer the authenticated identity for a signed-in PostgREST write; fall back to the
      -- app.actor GUC, then 'system' for service-role/import writes.
      coalesce(nullif(auth.jwt() ->> 'email', ''), nullif(current_setting('app.actor', true), ''), 'system')
    );
  end if;

  return new;
end;
$$;

-- S8: these are trigger functions, never meant to be called directly. Revoke the RPC EXECUTE grant.
revoke execute on function public.log_classification_change() from public, anon, authenticated;
revoke execute on function public.log_transaction_change() from public, anon, authenticated;
