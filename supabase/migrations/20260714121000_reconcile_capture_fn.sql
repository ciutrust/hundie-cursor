-- reconcile_capture — atomically match a capture to the real charge that settled it.
--
-- WHY AN RPC: reconciling is delete-old-link + set the match + pull the charge into the capture's
-- report + clear the stale expensed flag. supabase-js has no client transaction, so from Node that is
-- 3-4 un-atomic round-trips; a mid-sequence failure leaves a capture matched to a charge that never
-- joined the report — which, under the suppression rule, makes the report silently file SHORT by the
-- capture's amount. Same argument the splits writer makes (20260711121000): one plpgsql body is one
-- implicit transaction, and the money invariant lives in exactly one place.
--
-- CO-MEMBERSHIP IS THE POINT: a capture is only suppressed when its twin is a counted member of the
-- SAME report, so matching MUST also pull the charge into that report. Doing them as two separate user
-- actions is exactly how money goes missing (or gets double-counted).
--
-- SECURITY DEFINER + pinned search_path (mirrors the audit triggers / split RPC); revoked from
-- public+anon and called via the service-role client.

create or replace function reconcile_capture(p_capture_id uuid, p_transaction_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report_id uuid;
  v_capture_kind text;
  v_txn_report_id uuid;
  v_split_at timestamptz;
  v_removed_at timestamptz;
begin
  -- 1. Lock the capture; it must exist.
  select expense_report_id, capture_kind
    into v_report_id, v_capture_kind
  from expense_captures
  where id = p_capture_id
  for update;
  if not found then
    raise exception 'reconcile_capture: capture % not found', p_capture_id;
  end if;

  -- A cash capture IS the only record of that money — there is no charge to match it to.
  if v_capture_kind = 'cash' then
    raise exception 'reconcile_capture: capture % is cash and has no charge to match', p_capture_id;
  end if;

  -- 2. Lock the charge; it must exist and be a real, countable line.
  select expense_report_id, split_at, plaid_removed_at
    into v_txn_report_id, v_split_at, v_removed_at
  from transactions
  where id = p_transaction_id
  for update;
  if not found then
    raise exception 'reconcile_capture: transaction % not found', p_transaction_id;
  end if;
  if v_removed_at is not null then
    raise exception 'reconcile_capture: transaction % was reversed by the bank', p_transaction_id;
  end if;
  -- A split parent is N legs everywhere else; an all-or-nothing expensed flag on it would lie.
  if v_split_at is not null then
    raise exception 'reconcile_capture: transaction % is split; add its legs instead', p_transaction_id;
  end if;

  -- 3. One charge backs at most one capture (the partial unique index enforces it; this raises a
  --    readable error instead of a constraint violation).
  if exists (
    select 1 from expense_captures
    where matched_transaction_id = p_transaction_id and id <> p_capture_id
  ) then
    raise exception 'reconcile_capture: transaction % is already matched to another capture', p_transaction_id;
  end if;

  -- 4. Don't silently steal a charge out of a different report.
  if v_txn_report_id is not null and v_report_id is not null and v_txn_report_id <> v_report_id then
    raise exception
      'reconcile_capture: transaction % already belongs to a different expense report', p_transaction_id;
  end if;

  -- 5. Match + co-membership in one shot. If the capture has no report yet, adopt the charge's.
  update expense_captures
  set matched_transaction_id = p_transaction_id,
      match_status = 'matched',
      matched_at = now(),
      expense_report_id = coalesce(v_report_id, v_txn_report_id),
      updated_at = now()
  where id = p_capture_id;

  if v_report_id is not null then
    update transactions
    set expense_report_id = v_report_id
    where id = p_transaction_id;
  end if;
end;
$$;

/** Undo a match. The capture becomes its own countable line again — money reappears, never vanishes. */
create or replace function unreconcile_capture(p_capture_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update expense_captures
  set matched_transaction_id = null,
      match_status = 'unmatched',
      matched_at = null,
      updated_at = now()
  where id = p_capture_id;
end;
$$;

revoke execute on function reconcile_capture(uuid, uuid) from public, anon;
revoke execute on function unreconcile_capture(uuid) from public, anon;
