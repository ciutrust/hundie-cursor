-- Splits-writer PR (part 2/2) — the atomic split writer + its inverse.
--
-- The scaffold migration (20260705122000_transaction_splits.sql) intentionally DEFERRED the
-- sum-to-parent invariant + rollup exclusion "to the splits-writer PR". This is that writer.
--
-- Why an RPC and not app-side writes: a split is delete-old-legs + insert-new-legs + set split_at.
-- supabase-js has no client transaction, so doing this from Node would be 3 un-atomic round-trips —
-- a mid-sequence failure leaves split_at set with wrong/no legs, silently corrupting every rollup.
-- A plpgsql body is ONE implicit transaction (any `raise` rolls it all back) and co-locates the
-- money invariant in exactly one place. Both functions are SECURITY DEFINER with a pinned
-- search_path (mirrors the audit triggers) and are called via the service-role client.
--
-- Locked product rule: every leg REQUIRES a category (no "review later" legs), so category_id is
-- validated NOT NULL here — a categorized leg is never backlog, and there are no leg-backlog gaps.
-- Idempotent (create or replace).

create or replace function apply_transaction_split(p_transaction_id uuid, p_legs jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent_amount numeric(12, 2);
  v_sign int;
  v_leg_sum numeric(12, 2);
  v_leg_count int;
begin
  -- 1. Lock the parent; it must exist.
  select amount into v_parent_amount
  from transactions
  where id = p_transaction_id
  for update;
  if not found then
    raise exception 'apply_transaction_split: transaction % not found', p_transaction_id;
  end if;

  v_sign := sign(v_parent_amount);

  -- 2. Shape / count: need at least 2 legs.
  v_leg_count := jsonb_array_length(p_legs);
  if v_leg_count is null or v_leg_count < 2 then
    raise exception 'apply_transaction_split: need at least 2 legs, got %', coalesce(v_leg_count, 0);
  end if;

  -- 3. Per-leg validation. Each leg: { entity_id uuid, category_id uuid, amount numeric, notes text? }.
  --    Reject: missing entity, missing category (categories required), zero amount, opposite sign to
  --    the parent, non-existent entity, or a category that does not belong to the leg's entity.
  if exists (
    select 1
    from jsonb_to_recordset(p_legs)
      as l(entity_id uuid, category_id uuid, amount numeric)
    where l.entity_id is null
       or l.category_id is null
       or l.amount is null
       or l.amount = 0
       or sign(l.amount) <> v_sign
       or not exists (select 1 from entities e where e.id = l.entity_id)
       or not exists (
            select 1 from categories c
            where c.id = l.category_id and c.entity_id = l.entity_id
          )
  ) then
    raise exception
      'apply_transaction_split: invalid leg (each leg needs an entity + a category on that entity + a nonzero amount matching the parent sign)';
  end if;

  -- 4. Sum-to-parent, to the cent.
  select coalesce(sum(l.amount), 0) into v_leg_sum
  from jsonb_to_recordset(p_legs) as l(entity_id uuid, category_id uuid, amount numeric);
  if round(v_leg_sum, 2) <> round(v_parent_amount, 2) then
    raise exception 'apply_transaction_split: legs sum to % but parent is %', v_leg_sum, v_parent_amount;
  end if;

  -- 5. Replace legs atomically, then flag the parent.
  delete from transaction_splits where transaction_id = p_transaction_id;
  insert into transaction_splits (transaction_id, entity_id, category_id, amount)
  select p_transaction_id, l.entity_id, l.category_id, l.amount
  from jsonb_to_recordset(p_legs) as l(entity_id uuid, category_id uuid, amount numeric);

  update transactions set split_at = now() where id = p_transaction_id;
end;
$$;

create or replace function unsplit_transaction(p_transaction_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from transaction_splits where transaction_id = p_transaction_id;
  update transactions set split_at = null where id = p_transaction_id;
end;
$$;

revoke execute on function apply_transaction_split(uuid, jsonb) from public, anon;
revoke execute on function unsplit_transaction(uuid) from public, anon;
