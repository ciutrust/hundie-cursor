-- Acknowledgments for one-sided transfer legs.
--
-- WHY: the One-sided list on /reports/intercompany surfaces transfer-shaped rows with no
-- counterpart in the ledger. Some are permanently legitimate - the twin lives in an account
-- Hundie does not track (the Way2Save savings, Three Cities Trust checking, external HOME
-- PROJECTS account). Without a way to say "seen it, the other side is not tracked here", those
-- rows nag forever and drown the rows that actually need action. An ack removes a leg from the
-- list and carries an optional note for the accounting trail.
--
-- Conventions mirrored from intercompany_pair_dismissals (20260810121000): cascade FK, RLS with
-- authenticated SELECT-only (writes go through the service-role action).

create table if not exists intercompany_one_sided_acks (
  transaction_id uuid primary key references transactions (id) on delete cascade,
  note text,
  acked_by text,
  acked_at timestamptz not null default now()
);

alter table intercompany_one_sided_acks enable row level security;

drop policy if exists "intercompany_one_sided_acks authenticated select" on intercompany_one_sided_acks;

create policy "intercompany_one_sided_acks authenticated select" on intercompany_one_sided_acks
  for select to authenticated using (true);
