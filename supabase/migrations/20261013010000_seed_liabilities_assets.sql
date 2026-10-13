-- Phase A seed. Idempotent by name. Estimates are labeled in notes.
-- Does not touch classification tables.

insert into liabilities (type, name, entity_id, current_balance, interest_rate, notes)
select v.type, v.name, e.id, v.balance, v.rate, v.notes
from (
  values
    ('mortgage', 'Chase Mortgage — Winding Ridge', 'personal', 470000::numeric, 2.625::numeric, 'Estimate'),
    ('heloc', 'First Financial HELOC — Winding Ridge', 'personal', 100000, 7.5, 'Estimate'),
    ('mortgage', 'M&T Bank Mortgage — Joshua Tree', 'personal', 225000, 3.0, 'Investment property; estimate'),
    ('mortgage', 'SPS Servicing — Anita', 'personal', 220000, 7.0, 'Property owned by ACAA; debt Personal; estimate'),
    ('mortgage', 'Shellpoint — Fair Meadows', 'personal', 225000, 7.0, 'Property owned by ACAA; debt Personal; estimate'),
    ('auto_loan', 'Ford Loan — F150 Lightning', 'gbsl', 34284.31, 3.6, 'Exact'),
    ('business_loan', 'CNB Business Loan — GB Southlake', 'gbsl', 0, null, 'TBD; placeholder')
) as v(type, name, slug, balance, rate, notes)
join entities e on e.slug = v.slug
where not exists (select 1 from liabilities l where l.name = v.name);

insert into assets (type, name, entity_id, current_value, notes)
select v.type, v.name, e.id, v.value, v.notes
from (
  values
    ('property', '512 Winding Ridge, Southlake', 'personal', 0::numeric, 'Primary; value TBD'),
    ('property', '124 Joshua Tree, Pflugerville', 'personal', 0, 'Investment; value TBD'),
    ('property', '136 Anita, Keller', 'acaa-austin', 365000, 'Zestimate; estimate'),
    ('property', '6649 Fair Meadows Dr, Watauga', 'acaa-austin', 295000, 'Closed 7/31/2026; estimate'),
    ('vehicle', '2015 Honda Odyssey Touring', 'personal', 13000, 'Paid; estimate'),
    ('vehicle', '2023 Ford F150 Lightning Platinum', 'gbsl', 54000, 'Loan $34,284.31; estimate'),
    ('vehicle', '2011 Ford Focus', 'gbsl', 3500, 'Paid; estimate'),
    ('retirement', 'Fidelity 401k', 'personal', 300000, 'Approximate'),
    ('brokerage', 'E*TRADE', 'personal', 900000, 'Approximate'),
    ('brokerage', 'xmoney', 'personal', 80000, 'Approximate'),
    ('brokerage', 'Alignea', 'personal', 12000, 'Approximate'),
    ('education', 'Agatha''s 529 (Wells Fargo)', 'personal', 140000, ''),
    ('education', 'Anthony''s 529 (Wells Fargo)', 'personal', 125000, '')
) as v(type, name, slug, value, notes)
join entities e on e.slug = v.slug
where not exists (select 1 from assets a where a.name = v.name);

insert into asset_value_history (asset_id, value, source, notes)
select a.id, a.current_value, 'estimate', 'Initial seed'
from assets a
where a.current_value > 0
  and not exists (
    select 1 from asset_value_history h where h.asset_id = a.id
  );
