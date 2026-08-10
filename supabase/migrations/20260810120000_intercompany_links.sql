-- Intercompany links - the two legs of one transfer, bound as a single row.
--
-- WHY: an owner-funding wire or intercompany payment is ONE movement of money that lands as TWO
-- transaction rows in two accounts (sign convention: positive = outflow on the sending side,
-- negative = inflow on the receiving side). Until now the pairing lived in AC's head - he eyeballed
-- matching amounts and shared wire refs (e.g. REF #IB0Z7NFL7H showing up in both legs'
-- descriptions) and classified each side independently. That is exactly how books go one-sided:
-- one leg categorized as Owner Contribution, the twin forgotten or miscategorized, and the entity
-- totals quietly stop reconciling.
--
-- WHY A LINK TABLE instead of a paired_transaction_id column on transactions: a one-sided pointer
-- is exactly the failure mode this feature exists to prevent. A column can point at a twin whose
-- own pointer is null (or points somewhere else), and nothing in the schema notices. Here one row
-- IS the pair - it names both legs, both are NOT NULL, and the pair cannot half-exist.
--
-- Conventions mirrored from the newer additive tables (bills, expense_captures): text + CHECK
-- instead of CREATE TYPE, RLS with SELECT-only for authenticated, idempotent DDL.

create table if not exists intercompany_links (
  id uuid primary key default gen_random_uuid(),

  -- Plain UNIQUE is correct here, not a partial unique index: both columns are NOT NULL, so there
  -- are no null rows that would need excluding. (Contrast expense_captures'
  -- matched_transaction_id, whose partial unique index existed only because that column is
  -- nullable.) Each UNIQUE also doubles as the FK-covering index for its column.
  out_transaction_id uuid not null unique references transactions (id) on delete cascade,
  in_transaction_id uuid not null unique references transactions (id) on delete cascade,

  link_kind text not null
    check (link_kind in ('owner_funding', 'intercompany_service', 'internal_transfer')),

  -- The shared wire reference when one exists (e.g. 'IB0Z7NFL7H'). Provenance for the human, never
  -- a key - descriptions are bank-controlled text and Plaid can rewrite them.
  ref_token text,
  note text,
  created_by text,
  created_at timestamptz not null default now(),

  check (out_transaction_id <> in_transaction_id)
);

-- Cross-column collision backstop.
--
-- The two UNIQUE constraints stop a transaction from appearing twice in the SAME column, but not
-- the cross shape: transaction T as the out leg of link A and the in leg of link B. At link time
-- the RPC's sign guards make that shape unreachable (a leg cannot be strictly positive and
-- strictly negative at once) - but Plaid `modified` events can MUTATE amount/description after
-- import, so the sign-disjointness argument does not hold forever. This trigger is the
-- schema-level backstop that survives post-link mutation and any future write path that skips the
-- RPC.
create or replace function intercompany_links_no_cross_column_reuse()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- NEW.id is populated on INSERT too (column default fires before BEFORE triggers run), so the
  -- id <> new.id exclusion is correct for both INSERT and UPDATE: it never matches an existing row
  -- on insert, and excludes exactly the row being updated on update.
  if exists (
    select 1 from intercompany_links l
    where l.id <> new.id
      and (
        l.out_transaction_id in (new.out_transaction_id, new.in_transaction_id)
        or l.in_transaction_id in (new.out_transaction_id, new.in_transaction_id)
      )
  ) then
    raise exception
      'intercompany_links: transaction % or % already belongs to another intercompany link',
      new.out_transaction_id, new.in_transaction_id;
  end if;

  return new;
end;
$$;

-- Trigger functions are never meant to be called via /rest/v1/rpc/*. Supabase default privileges
-- grant EXECUTE to authenticated DIRECTLY (the 20260717120000 lesson: revoking from public alone
-- does not remove that grant), so revoke explicitly. The trigger still fires - triggers run as the
-- definer regardless of EXECUTE.
revoke execute on function intercompany_links_no_cross_column_reuse()
  from public, anon, authenticated;

drop trigger if exists intercompany_links_no_cross_column_reuse_trg on intercompany_links;
create trigger intercompany_links_no_cross_column_reuse_trg
  before insert or update on intercompany_links
  for each row execute function intercompany_links_no_cross_column_reuse();

alter table intercompany_links enable row level security;

-- SELECT-only for authenticated (mirrors self_rental_links): reads use the authenticated client in
-- lib/queries; every write goes through the service-role RPCs (link_intercompany_pair /
-- unlink_intercompany_pair), so no INSERT/UPDATE/DELETE policies exist at all.
drop policy if exists "intercompany_links authenticated select" on intercompany_links;
create policy "intercompany_links authenticated select" on intercompany_links
  for select to authenticated using (true);
