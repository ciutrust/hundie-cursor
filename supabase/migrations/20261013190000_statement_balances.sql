-- Statement balances entered 2026-10-13. Rates are unchanged.

update public.liabilities l
set
  current_balance = v.balance,
  notes = v.notes,
  updated_at = now()
from (
  values
    ('Chase Mortgage — Winding Ridge', 473316.08::numeric, 'Balance entered 10/13/2026. Rate 2.625%.'),
    ('First Financial HELOC — Winding Ridge', 104805.59, 'Balance entered 10/13/2026. Rate 7.5%.'),
    ('M&T Bank Mortgage — Joshua Tree', 214959.02, 'Investment property. Balance entered 10/13/2026. Rate 3%.'),
    ('SPS Servicing — Anita', 222714.43, 'Property owned by ACAA; debt Personal. Balance entered 10/13/2026. Rate 7%.')
) as v(name, balance, notes)
where l.name = v.name;
