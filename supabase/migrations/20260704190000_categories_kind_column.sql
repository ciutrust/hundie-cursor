-- WS-E BUG-08 (durable) — nullable categories.kind column + backfill from the category full_path.
--
-- FILE ONLY / STAGE-2: this migration is NOT applied at runtime now. The hardcoded path Sets in
-- lib/category-kind.ts remain the AUTHORITATIVE source of category kind at runtime — categoryKind()
-- must NOT be refactored to read this column until Stage 2, because the column does not exist until
-- this migration is applied. This durably persists the kind so a future Stage-2 step can switch the
-- runtime over to the column (and so SQL-side rollups can read kind without re-deriving the map).
--
-- Runs LAST in the 20260704* batch so the backfill also covers every category the earlier WS-E
-- seed migrations add (vehicle-loan / mortgage / intercompany / meals / rent-location splits).
--
-- The backfill mirrors lib/category-kind.ts EXACTLY: same path Sets, same dispatch precedence
-- (transfer → funding → capital → liability → non_deductible → income → else expense; null/blank →
-- unclassified), and the SAME normalization the runtime uses (categoryKind: trim + collapse internal
-- whitespace) via regexp_replace(btrim(full_path), '\s+', ' ', 'g'). Em-dashes are U+2014 to match.

-- Additive column (idempotent).
alter table categories add column if not exists kind text;

-- Additive CHECK guard (idempotent via pg_constraint lookup). Every backfilled value is controlled,
-- so it cannot fail; it just keeps a future hand-write from inserting an unknown kind.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'categories_kind_chk'
  ) then
    alter table categories add constraint categories_kind_chk
      check (kind is null or kind in (
        'expense', 'income', 'transfer', 'funding', 'capital',
        'liability', 'non_deductible', 'unclassified'
      ));
  end if;
end $$;

-- Backfill in runtime precedence order; each step only fills rows still null so precedence holds
-- even though the Sets are disjoint. Normalized path = btrim + collapsed internal whitespace.

-- transfer
update categories set kind = 'transfer'
where kind is null and regexp_replace(btrim(full_path), '\s+', ' ', 'g') in (
  'Credit card payment',
  'Transfer / Zelle (personal)',
  'Refund / credit',
  'Security deposit movement',
  '→ GBSL business expense',
  '→ Keller business expense',
  '→ Austin ACAA (136 Anita)',
  '→ Pflugerville rental',
  '→ Personal (mis-posted)',
  'Mixed / pending allocation',
  'Sales Tax Payable',
  'Credit card rewards / cash back'
);

-- funding
update categories set kind = 'funding'
where kind is null and regexp_replace(btrim(full_path), '\s+', ' ', 'g') in (
  'Intercompany — pending',
  'Owner Contribution',
  'Owner Distribution',
  'Owners Equity',
  'Owners Equity:Owner Distribution'
);

-- capital
update categories set kind = 'capital'
where kind is null and regexp_replace(btrim(full_path), '\s+', ' ', 'g') in (
  'Leasehold improvements',
  'Leasehold Improvements',
  'Tenant improvement allowance',
  'Property purchase'
);

-- liability
update categories set kind = 'liability'
where kind is null and regexp_replace(btrim(full_path), '\s+', ' ', 'g') in (
  'Mortgage principal payment',
  'Mortgage principal — primary home',
  'Ford Motor Credit - F150:Principal'
);

-- non_deductible
update categories set kind = 'non_deductible'
where kind is null and regexp_replace(btrim(full_path), '\s+', ' ', 'g') in (
  'Tax Penalty'
);

-- income
update categories set kind = 'income'
where kind is null and regexp_replace(btrim(full_path), '\s+', ' ', 'g') in (
  'Membership Income',
  'Membership revenue',
  'Salary & wages',
  'Investment proceeds',
  'Interest income',
  'Other income',
  'Rent income',
  'Intercompany — 136 Anita (income)'
);

-- else expense (any remaining non-blank path)
update categories set kind = 'expense'
where kind is null and regexp_replace(btrim(full_path), '\s+', ' ', 'g') <> '';

-- null / blank → unclassified
update categories set kind = 'unclassified'
where kind is null;
