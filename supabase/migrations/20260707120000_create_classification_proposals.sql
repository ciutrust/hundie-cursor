-- Stage 2 — classification_proposals: a STAGING table for the /review/proposals page.
--
-- Recommendations are written here by two writers (both via the service-role client, which
-- bypasses RLS): (1) the Tier-1 deterministic generator (scripts/stage2/generate-proposals.mjs,
-- source='training') and (2) Claude's in-session analysis of unknown vendors (source='claude').
-- The page lets the operator approve/reject/override; only "Commit approved" writes real rows into
-- `classifications`. Until then this table is fully isolated from /review, /reports, and the app.
--
-- Additive + droppable. One CURRENT proposal per transaction (unique transaction_id) — re-running
-- the generator upserts and resets status to 'pending'.
--
-- SECURITY: RLS enabled, authenticated read/insert/update (mirrors the ai_suggestions policy set;
-- deletes/regeneration happen via the service-role client).

create table if not exists classification_proposals (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references transactions (id) on delete cascade,
  entity_id uuid not null references entities (id) on delete cascade,
  entity_slug text not null,
  vendor_key text not null default '',
  proposed_category_id uuid references categories (id) on delete set null,
  proposed_category_path text,
  chosen_category_id uuid references categories (id) on delete set null,
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  source text not null check (source in ('training', 'claude')),
  rationale text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'committed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  committed_at timestamptz,
  unique (transaction_id)
);

create index if not exists classification_proposals_entity_status_idx
  on classification_proposals (entity_id, status);
create index if not exists classification_proposals_vendor_idx
  on classification_proposals (entity_id, vendor_key);
create index if not exists classification_proposals_status_idx
  on classification_proposals (status);

alter table classification_proposals enable row level security;

drop policy if exists "Authenticated users can read classification_proposals" on classification_proposals;
create policy "Authenticated users can read classification_proposals"
  on classification_proposals for select
  to authenticated
  using (true);

drop policy if exists "Authenticated users can insert classification_proposals" on classification_proposals;
create policy "Authenticated users can insert classification_proposals"
  on classification_proposals for insert
  to authenticated
  with check (true);

drop policy if exists "Authenticated users can update classification_proposals" on classification_proposals;
create policy "Authenticated users can update classification_proposals"
  on classification_proposals for update
  to authenticated
  using (true)
  with check (true);
