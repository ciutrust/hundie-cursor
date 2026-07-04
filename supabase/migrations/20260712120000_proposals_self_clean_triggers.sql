-- Self-cleaning proposals — a transaction that becomes RESOLVED auto-skips its lingering proposal.
--
-- The recommendations page (getProposalsForEntity) shows classification_proposals with status
-- pending/approved. But resolving a transaction OUTSIDE the proposal-commit flow — a manual reclassify,
-- an AI-suggestion accept, a QBO backfill, a transaction SPLIT, or a direct SQL edit — writes the ledger
-- WITHOUT touching its proposal, so the stale proposal keeps showing until a manual sync runs. These
-- triggers do that sync automatically, on every path, at the DB level:
--   - a classification gains a category  → skip that transaction's pending/approved proposals
--   - a transaction gains a split_at     → skip that transaction's pending/approved proposals
--
-- Safe with the proposal-COMMIT flow (lib/actions/proposals.ts): commit upserts the classification
-- (fires this trigger → proposal momentarily 'skipped') and THEN sets status='committed' WHERE id = ANY
-- (unconditional on current status), so the committed proposal ends 'committed'. SECURITY DEFINER +
-- pinned search_path so the update to classification_proposals is not blocked by the invoker's RLS
-- (mirrors the audit triggers / the split RPC). Idempotent (create or replace / drop trigger if exists).

create or replace function tg_skip_proposals_on_classify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.category_id is not null then
    update classification_proposals
    set status = 'skipped', updated_at = now()
    where transaction_id = NEW.transaction_id
      and status in ('pending', 'approved');
  end if;
  return NEW;
end;
$$;

drop trigger if exists classifications_skip_proposals on classifications;
create trigger classifications_skip_proposals
  after insert or update of category_id on classifications
  for each row
  execute function tg_skip_proposals_on_classify();

create or replace function tg_skip_proposals_on_split()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only on a real split (null/other → a timestamp); an unsplit (→ null) leaves NEW.split_at null.
  if NEW.split_at is not null and NEW.split_at is distinct from OLD.split_at then
    update classification_proposals
    set status = 'skipped', updated_at = now()
    where transaction_id = NEW.id
      and status in ('pending', 'approved');
  end if;
  return NEW;
end;
$$;

drop trigger if exists transactions_skip_proposals_on_split on transactions;
create trigger transactions_skip_proposals_on_split
  after update of split_at on transactions
  for each row
  execute function tg_skip_proposals_on_split();
