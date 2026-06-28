-- WS-F TAX-03 — category → tax-form-line mapping.
--
-- FILE ONLY / STAGE-2: additive nullable columns + a CONSERVATIVE backfill of the CLEAR mappings only.
-- Ambiguous categories are left tax_line NULL on purpose (the CPA fills them). off-P&L kinds get
-- tax_form='none'. References categories.kind (added/backfilled in 20260704190000, which sorts earlier
-- so kind is populated before this runs). New rows seeded by the later 20260705* migrations set their
-- own mapping inline, so there is no "must run last" dependency on this file.
--
-- Full_path strings verified against the live chart: GBSL (scripts/.qb-import-sql/01-categories.sql +
-- the WS-E 20260704* rent/meals/intercompany splits), rentals (20260627120000 + 20260629120000 +
-- 20260704120000), personal (20260626120000 + 20260629120000 + 20260704120000). Em-dashes are U+2014.

alter table categories add column if not exists tax_line text;
alter table categories add column if not exists tax_form text;

-- Guarded CHECK (pg_constraint-guarded; broad + easily extended by a one-line follow-up migration).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'categories_tax_form_chk') then
    alter table categories add constraint categories_tax_form_chk
      check (tax_form is null or tax_form in (
        'sch_c','sch_e','sch_a','sch_b','sch_d',
        'form_4562','form_8829','form_8889','form_2441','form_5695','form_8936',
        'none'
      ));
  end if;
end $$;

-- Optional report-foundation index (additive, cheap; WS-G rollup-by-tax-line).
create index if not exists categories_tax_form_idx on categories (tax_form) where tax_form is not null;

-- 1) off-P&L kinds → tax_form='none' (transfer / funding / liability / non_deductible).
--    'capital' is intentionally EXCLUDED (leasehold/property purchase → Form 4562 depreciation, CPA).
--    'income' left NULL (gross-receipts/gross-rents line mapping is a follow-up). Guarded idempotent.
update categories set tax_form = 'none', updated_at = now()
where tax_form is null and kind in ('transfer','funding','liability','non_deductible');

-- 2) Clear per-entity expense / Sch-A mappings, one consolidated guarded UPDATE.
--    Em-dashes are U+2014 to match the existing chart. Guard on tax_form IS NULL keeps it idempotent
--    and never clobbers a CPA edit. First row has non-null tax_line so the VALUES columns type as text.
update categories c
set tax_form = m.tax_form, tax_line = m.tax_line, updated_at = now()
from (values
  -- GBSL → Schedule C (Part II expense lines)
  ('gbsl','Advertising & Marketing','sch_c','Line 8'),
  ('gbsl','Contract Labor','sch_c','Line 11'),
  ('gbsl','Insurance','sch_c','Line 15'),
  ('gbsl','Legal & Professional Fees','sch_c','Line 17'),
  ('gbsl','Legal & Professional Fees:Accounting Fees','sch_c','Line 17'),
  ('gbsl','Legal & Professional Fees:Legal Fees','sch_c','Line 17'),
  ('gbsl','Legal & Professional Fees:Professional Fees','sch_c','Line 17'),
  ('gbsl','Office Expense','sch_c','Line 18'),
  ('gbsl','Rent Expense','sch_c','Line 20b'),
  ('gbsl','Rent Expense:US Property Trust','sch_c','Line 20b'),
  ('gbsl','Rent Expense:Kobalt Investment','sch_c','Line 20b'),
  ('gbsl','Rent Expense:CubeSmart storage','sch_c','Line 20b'),
  ('gbsl','Rent Expense:Three77 Park','sch_c','Line 20b'),
  ('gbsl','Repairs & Maintenance','sch_c','Line 21'),
  ('gbsl','Taxes and Licenses','sch_c','Line 23'),
  ('gbsl','Travel','sch_c','Line 24a'),
  ('gbsl','Meals (50%)','sch_c','Line 24b'),
  ('gbsl','Meals (100%)','sch_c','Line 24b'),   -- both meal buckets report on Line 24b (the % is in the name)
  ('gbsl','Utilities','sch_c','Line 25'),

  -- Rentals → Schedule E (acaa-austin + pflugerville share the same chart).
  -- 'Supplies' (Sch-E L15) and 'Cleaning & maintenance' (Sch-E L7) are seeded for both rentals by the
  -- WS-E chart_tidy split (20260704125000, which sorts earlier), so they exist when this runs and are
  -- mapped here; the guarded `c.tax_form is null` join no-ops harmlessly on any chart that lacks them.
  ('acaa-austin','Advertising & listing','sch_e','Line 5'),
  ('acaa-austin','Travel to property','sch_e','Line 6'),
  ('acaa-austin','Cleaning & maintenance','sch_e','Line 7'),
  ('acaa-austin','Insurance — rental property','sch_e','Line 9'),
  ('acaa-austin','Professional services (legal, CPA)','sch_e','Line 10'),
  ('acaa-austin','Mortgage interest','sch_e','Line 12'),
  ('acaa-austin','Repairs & maintenance','sch_e','Line 14'),
  ('acaa-austin','Supplies','sch_e','Line 15'),
  ('acaa-austin','Property taxes','sch_e','Line 16'),
  ('acaa-austin','Utilities — rental','sch_e','Line 17'),
  ('acaa-austin','Depreciation (CPA)','sch_e','Line 18'),
  ('pflugerville','Advertising & listing','sch_e','Line 5'),
  ('pflugerville','Travel to property','sch_e','Line 6'),
  ('pflugerville','Cleaning & maintenance','sch_e','Line 7'),
  ('pflugerville','Insurance — rental property','sch_e','Line 9'),
  ('pflugerville','Professional services (legal, CPA)','sch_e','Line 10'),
  ('pflugerville','Mortgage interest','sch_e','Line 12'),
  ('pflugerville','Repairs & maintenance','sch_e','Line 14'),
  ('pflugerville','Supplies','sch_e','Line 15'),
  ('pflugerville','Property taxes','sch_e','Line 16'),
  ('pflugerville','Utilities — rental','sch_e','Line 17'),
  ('pflugerville','Depreciation (CPA)','sch_e','Line 18'),

  -- Personal → Schedule A (clear only)
  ('personal','Mortgage interest — primary home','sch_a','Home mortgage interest (Sch A)'),
  ('personal','State & local taxes (SALT)','sch_a','SALT (Sch A, $10k cap)'),
  ('personal','Medical & dental','sch_a','Medical & dental (Sch A, 7.5% AGI floor)'),
  ('personal','Charitable contributions','sch_a','Charitable contributions (Sch A)'),

  -- Personal consumption that is UNAMBIGUOUSLY never on a return → 'none' (clear, not "CPA-TBD").
  -- These rows are kind=expense, so they are NOT caught by the kind-driven 'none' rule above; the
  -- enumeration is deliberate. Veto by removing rows if you would rather leave them NULL.
  ('personal','Groceries & household','none',null),
  ('personal','Dining & entertainment','none',null),
  ('personal','Clothing & personal care','none',null),
  ('personal','Personal travel & vacation','none',null),
  ('personal','Subscriptions & memberships','none',null),
  ('personal','Gifts (non-charitable)','none',null),
  ('personal','Pets','none',null),
  ('personal','Auto & fuel (personal use)','none',null),
  ('personal','Home maintenance & improvements','none',null),
  ('personal','Utilities — primary residence','none',null),
  ('personal','Insurance — personal','none',null),
  ('personal','Hobbies & recreation','none',null),
  ('personal','Credit card interest (non-deductible)','none',null)
) as m(slug, full_path, tax_form, tax_line)
join entities e on e.slug = m.slug
where c.entity_id = e.id and c.full_path = m.full_path and c.tax_form is null;

-- Left tax_line NULL ON PURPOSE (ambiguous — CPA fills later; do NOT guess):
--   GBSL: Auto Expense (+:Fuel, :Parking & Tolls), 2023 F-150 Lightning, Ford Focus, Equipment,
--     Leasehold Improvements, Ford Motor Credit - F150 (+:Interest) — depreciation/§179/Form 4562;
--     Cost of Goods Sold (+:School Wear) — Part III not Part II; Interest Expense, Bank Fees,
--     Merchant Fees, Software, Dues & Subscriptions, Phone & Internet, Postage, Office Supplies,
--     Job Supplies, Janitorial Supplies, Events/Supplies, Continuing Education, Business Licenses and
--     Permits, Gift, Tournament Fees, Tournament Prep, NP Alejandro Siqueira, Taxes Paid,
--     Charitable Contributions, Franchise Fees (Gracie Barra royalty — likely Line 27a),
--     Entertainment (0%), Ask My Accountant, Meals & Entertainment (superseded by the meals split),
--     Intercompany — 136 Anita (self-rental — surfaced via TAX-15). (Ford Motor Credit - F150:Principal
--     is kind=liability → caught by the 'none' rule.) Keller chart left entirely unmapped pending its
--     return type (TAX-13 caveat).
--   Rentals: HOA / property management, Landscaping & pest control, Bank fees,
--     Interest expense (credit card), Meals & entertainment (rental). (Income/transfer/liability rows
--     are handled by kind: Rent income/Intercompany — 136 Anita (income) left NULL as income;
--     Mortgage principal payment/Security deposit movement/Refund / credit/→ … /Mixed / pending → 'none'.)
--   Personal: Childcare & family (→ Form 2441 cat in TAX-16), Education — personal, Investment fees &
--     tax prep, Casualty & theft loss, Legal & professional fees. (Mortgage principal — primary home is
--     kind=liability → 'none'.)
