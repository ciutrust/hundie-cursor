-- Paid reports are FILED reports - reconciling into one silently rewrites a number AC already
-- submitted and got reimbursed for.
--
-- THE HOLE (adversarial review, 2026-07-17): reconcile_capture pulls the charge into the capture's
-- report and flips suppression, moving the report total - but unlike every other write path
-- (createExpenseCapture, addToExpenseReport both refuse paid reports), it never checked paid_at.
-- The new stale-capture banner made this reachable in one click: a week-old unmatched capture in a
-- since-paid report deep-links straight to the confirm button. The banner now filters those out,
-- and this guard closes the gap at the source so no future surface can reopen it.
--
-- unreconcile_capture gets the mirror guard: unmatching a capture inside a paid report makes the
-- capture count again, moving the filed total the other direction. The escape hatch for a genuine
-- fix is deliberate friction: unmark the report as paid first, repair, mark paid again.
--
-- create or replace preserves the existing ACLs (EXECUTE revoked from public/anon/authenticated in
-- 20260717120000; service_role retains).

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
  v_paid_at timestamptz;
  v_target_report_id uuid;
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

  -- A cash capture IS the only record of that money - there is no charge to match it to.
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

  -- 5. A paid report is a FILED report - its total must never move. Lock it so a concurrent
  --    "mark paid" can't slip between this check and the writes below.
  v_target_report_id := coalesce(v_report_id, v_txn_report_id);
  if v_target_report_id is not null then
    select paid_at into v_paid_at
    from expense_reports
    where id = v_target_report_id
    for update;
    if v_paid_at is not null then
      raise exception
        'reconcile_capture: the expense report is already marked paid - unmark it as paid first';
    end if;
  end if;

  -- 6. Match + co-membership in one shot. If the capture has no report yet, adopt the charge's.
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

/**
 * Undo a match. The capture becomes its own countable line again - money reappears, never vanishes.
 * Refuses inside a paid report (that would move a filed total); missing captures stay a silent
 * no-op, matching the original behavior.
 */
create or replace function unreconcile_capture(p_capture_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report_id uuid;
  v_paid_at timestamptz;
begin
  select expense_report_id into v_report_id
  from expense_captures
  where id = p_capture_id
  for update;
  if not found then
    return;
  end if;

  if v_report_id is not null then
    select paid_at into v_paid_at
    from expense_reports
    where id = v_report_id
    for update;
    if v_paid_at is not null then
      raise exception
        'unreconcile_capture: the expense report is already marked paid - unmark it as paid first';
    end if;
  end if;

  update expense_captures
  set matched_transaction_id = null,
      match_status = 'unmatched',
      matched_at = null,
      updated_at = now()
  where id = p_capture_id;
end;
$$;
