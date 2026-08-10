-- link_intercompany_pair / unlink_intercompany_pair - the only write path into intercompany_links.
--
-- WHY AN RPC: linking is guard-check both legs + insert the link + clear any dismissal, and the
-- guards only mean something if they run against ROWS LOCKED in the same transaction. supabase-js
-- has no client transaction, so from Node that is several un-atomic round-trips where a concurrent
-- Plaid sync or split could invalidate a leg between check and insert. One plpgsql body is one
-- implicit transaction (same argument as 20260711121000 and 20260714121000), and the pairing
-- invariants live in exactly one place.
--
-- SECURITY DEFINER + pinned search_path, EXECUTE revoked from public/anon/authenticated at the
-- bottom of THIS file; the service-role client is the only caller.

create or replace function link_intercompany_pair(
  p_out uuid,
  p_in uuid,
  p_kind text,
  p_ref_token text default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_out_amount numeric(12, 2);
  v_out_account_id uuid;
  v_out_removed_at timestamptz;
  v_out_split_at timestamptz;
  v_in_amount numeric(12, 2);
  v_in_account_id uuid;
  v_in_removed_at timestamptz;
  v_in_split_at timestamptz;
  v_link_id uuid;
begin
  -- 0. Validate the kind early with a readable error. The table CHECK would catch it anyway, but
  --    only after every guard below has run, and as an opaque constraint violation.
  if p_kind is null
     or p_kind not in ('owner_funding', 'intercompany_service', 'internal_transfer') then
    raise exception
      'link_intercompany_pair: unknown link kind %; expected owner_funding, intercompany_service or internal_transfer',
      p_kind;
  end if;

  -- 1. A leg cannot pair with itself.
  if p_out = p_in then
    raise exception 'link_intercompany_pair: the two legs must be different transactions';
  end if;

  -- 2. Lock BOTH rows in one sweep ordered by id: deterministic lock order regardless of argument
  --    order, so two concurrent calls over overlapping legs queue instead of deadlocking. The row
  --    locks are held for the rest of the transaction, so the per-leg reads below see stable rows.
  perform 1 from transactions where id in (p_out, p_in) order by id for update;

  select amount, account_id, plaid_removed_at, split_at
    into v_out_amount, v_out_account_id, v_out_removed_at, v_out_split_at
  from transactions where id = p_out;
  if not found then
    raise exception 'link_intercompany_pair: outflow transaction % not found', p_out;
  end if;

  select amount, account_id, plaid_removed_at, split_at
    into v_in_amount, v_in_account_id, v_in_removed_at, v_in_split_at
  from transactions where id = p_in;
  if not found then
    raise exception 'link_intercompany_pair: inflow transaction % not found', p_in;
  end if;

  -- 3/4. Sign convention: positive = outflow, negative = inflow.
  if v_out_amount <= 0 then
    raise exception 'link_intercompany_pair: the outflow side must be a positive (outflow) amount';
  end if;
  if v_in_amount >= 0 then
    raise exception 'link_intercompany_pair: the inflow side must be a negative (inflow) amount';
  end if;

  -- 5. Exact mirror, no tolerance. WF internal transfers are exact on both legs; a fee-netted wire
  --    should be handled by splitting the fee out (20260711121000), never by a tolerance that
  --    would let genuinely different money link silently.
  if v_out_amount <> -v_in_amount then
    raise exception
      'link_intercompany_pair: amounts do not mirror exactly (out %, in %)', v_out_amount, v_in_amount;
  end if;

  -- 6. Neither leg may be bank-reversed or split. A removed row is money that never moved; a split
  --    parent is N legs everywhere else in the app, so linking the parent would lie.
  if v_out_removed_at is not null then
    raise exception 'link_intercompany_pair: outflow transaction % was reversed by the bank', p_out;
  end if;
  if v_in_removed_at is not null then
    raise exception 'link_intercompany_pair: inflow transaction % was reversed by the bank', p_in;
  end if;
  if v_out_split_at is not null then
    raise exception 'link_intercompany_pair: outflow transaction % is split; link its legs instead', p_out;
  end if;
  if v_in_split_at is not null then
    raise exception 'link_intercompany_pair: inflow transaction % is split; link its legs instead', p_in;
  end if;

  -- 7. A transfer never lands in the account it left.
  if v_out_account_id = v_in_account_id then
    raise exception
      'link_intercompany_pair: both legs are in the same account - a transfer never lands in the account it left';
  end if;

  -- 8. Neither leg may already be part of a link. Readable error here; the UNIQUE constraints and
  --    the cross-column trigger (20260810120000) are the backstop.
  if exists (
    select 1 from intercompany_links
    where out_transaction_id in (p_out, p_in)
       or in_transaction_id in (p_out, p_in)
  ) then
    raise exception
      'link_intercompany_pair: one of the legs already belongs to an intercompany link';
  end if;

  -- created_by stays null from this path: the RPC runs as service-role and has no JWT identity
  -- worth recording; provenance, if wanted, is the action layer's job.
  insert into intercompany_links (out_transaction_id, in_transaction_id, link_kind, ref_token, note)
  values (p_out, p_in, p_kind, p_ref_token, p_note)
  returning id into v_link_id;

  -- Linking supersedes a dismissal: a pair that was dismissed and later linked anyway must not
  -- linger as "dismissed" and confuse the suggestion engine's history.
  delete from intercompany_pair_dismissals
  where out_transaction_id = p_out and in_transaction_id = p_in;

  return v_link_id;
end;
$$;

-- Undo a link. Silent no-op when the id is missing (mirrors unreconcile_capture): unlink is
-- idempotent by nature, and a double-click on "unlink" is not an error worth surfacing.
create or replace function unlink_intercompany_pair(p_link_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from intercompany_links where id = p_link_id;
end;
$$;

-- The 20260717120000 lesson, applied IN THE SAME FILE so no exposed window ever exists: Supabase
-- default privileges grant EXECUTE to authenticated DIRECTLY, and that grant survives a revoke
-- from public. These are SECURITY DEFINER, so without this an authenticated browser session could
-- call them via supabase.rpc() and walk straight past the service-role-only boundary. service_role
-- retains EXECUTE and stays the only caller.
revoke execute on function link_intercompany_pair(uuid, uuid, text, text, text)
  from public, anon, authenticated;
revoke execute on function unlink_intercompany_pair(uuid)
  from public, anon, authenticated;
