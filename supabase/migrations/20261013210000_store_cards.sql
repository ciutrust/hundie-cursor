-- Store cards that are not in Plaid. Personal, 0% for now.
-- Balances are edited on the liabilities page.

insert into public.liabilities (type, name, entity_id, current_balance, interest_rate, notes)
select 'credit_card', v.name, e.id, v.balance, 0, 'Not linked to Plaid. 0% for now.'
from (
  values
    ('Home Depot Credit Card', 11747.02::numeric),
    ('Best Buy Credit Card', 12972.46),
    ('Amazon Credit Card', 6717.86),
    ('Living Spaces Credit Card', 4000)
) as v(name, balance)
join public.entities e on e.slug = 'personal'
where not exists (select 1 from public.liabilities l where l.name = v.name);
