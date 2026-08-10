-- Intercompany pair dismissals + the categories the paired legs classify into.
--
-- DISMISSALS: the suggestion engine proposes (out, in) candidate pairs from amount/date/ref
-- matching. A dismissed pair must STAY dismissed across re-runs, or the same false positive nags
-- forever (the bills suggest-confirm flow already learned this). Keyed by the pair itself, not a
-- surrogate id: dismissing is a fact about the pair, and the composite PK makes re-dismissing the
-- same pair a natural conflict instead of a duplicate row.

create table if not exists intercompany_pair_dismissals (
  out_transaction_id uuid not null references transactions (id) on delete cascade,
  in_transaction_id uuid not null references transactions (id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (out_transaction_id, in_transaction_id)
);

-- The composite PK covers FK lookups on out_transaction_id (leading column); the in-side FK needs
-- its own covering index so a transaction delete does not seq-scan (mirrors 20260709121000).
create index if not exists intercompany_pair_dismissals_in_transaction_id_idx
  on intercompany_pair_dismissals (in_transaction_id);

alter table intercompany_pair_dismissals enable row level security;

-- SELECT-only for authenticated: reads use the authenticated client; dismiss/undismiss writes go
-- through service-role actions (same posture as intercompany_links).
drop policy if exists "intercompany_pair_dismissals authenticated select" on intercompany_pair_dismissals;
create policy "intercompany_pair_dismissals authenticated select" on intercompany_pair_dismissals
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------------------------
-- Category seeds for the paired legs. All top-level, so name = full_path. kind is set EXPLICITLY
-- (the 20260704190000 backfill ran once and will not touch rows inserted after it) and
-- tax_form = 'none' (funding/transfer are off-P&L money movement, the 20260705120000 rule).
--
-- 'Owner transfer to business' (personal) exists in the live DB with no migration seeding it, and
-- 'Owner Contribution'/'Owner Distribution' may already exist for some entities - so every insert
-- must be a clean no-op when the row is present. The unique (entity_id, full_path) constraint
-- exists (20260625120000), so ON CONFLICT DO NOTHING gives exactly that, and deliberately leaves a
-- pre-existing row's kind/tax_form untouched rather than rewriting live chart data.

insert into categories (entity_id, name, full_path, kind, tax_form, is_active)
select e.id, v.name, v.name, v.kind, 'none', true
from (values
  -- Personal's leg of an owner-funding wire (personal -> business).
  ('personal',    'Owner transfer to business', 'funding'),
  -- The business-side legs of owner money in/out. GBSL and Personal already have these
  -- (20260702160000); Keller and Austin ACAA get theirs here.
  ('keller',      'Owner Contribution',         'funding'),
  ('keller',      'Owner Distribution',         'funding'),
  ('acaa-austin', 'Owner Contribution',         'funding'),
  ('acaa-austin', 'Owner Distribution',         'funding'),
  -- Same-entity account-to-account movement (never P&L on either side).
  ('keller',      'Internal transfer',          'transfer'),
  ('gbsl',        'Internal transfer',          'transfer'),
  ('personal',    'Internal transfer',          'transfer')
) as v(slug, name, kind)
join entities e on e.slug = v.slug
on conflict (entity_id, full_path) do nothing;
