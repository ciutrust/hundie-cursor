-- Book values from the GBSL QuickBooks ledger, entered 2026-10-13.
-- Southlake is goodwill net of amortization. Coppell is the 2024 buildout.
-- Trucks and loans stay on their own rows.

insert into public.assets (type, name, entity_id, current_value, notes)
select v.type, v.name, e.id, v.value, v.notes
from (
  values
    ('other', 'GB Southlake', 618816.99::numeric, 'Book value of the purchase. Goodwill was $792,000 on 10/02/2022. Amortization through 2025 is $173,183.01. Does not include the $32,966.40 Southlake remodel or depreciation, which the books do not split by gym.'),
    ('other', 'GB Coppell', 89292.04, 'Buildout capitalized from April 2024. Only $10,000 of the lines say Coppell. The rest is the same leasehold account with no location. Gross, before depreciation.')
) as v(type, name, value, notes)
join public.entities e on e.slug = 'gbsl'
where not exists (select 1 from public.assets a where a.name = v.name);

insert into public.asset_value_history (asset_id, valued_on, value, source, notes)
select a.id, date '2026-10-13', a.current_value, 'manual', 'From the GBSL QuickBooks balance sheet and general ledger.'
from public.assets a
where a.name in ('GB Southlake', 'GB Coppell')
  and not exists (
    select 1 from public.asset_value_history h
    where h.asset_id = a.id and h.valued_on = date '2026-10-13' and h.value = a.current_value
  );
