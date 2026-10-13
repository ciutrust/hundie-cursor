-- Tie a loan to the asset it is on. Credit cards stay unlinked.

alter table public.liabilities
  add column if not exists asset_id uuid references public.assets(id) on delete set null;

create index if not exists liabilities_asset_id_idx on public.liabilities (asset_id);

update public.liabilities l
set asset_id = a.id
from (
  values
    ('Chase Mortgage — Winding Ridge', '512 Winding Ridge, Southlake'),
    ('First Financial HELOC — Winding Ridge', '512 Winding Ridge, Southlake'),
    ('M&T Bank Mortgage — Joshua Tree', '124 Joshua Tree, Pflugerville'),
    ('SPS Servicing — Anita', '136 Anita, Keller'),
    ('Shellpoint — Fair Meadows', '6649 Fair Meadows Dr, Watauga'),
    ('Ford Loan — F150 Lightning', '2023 Ford F150 Lightning Platinum'),
    ('BHG Business Loan — GB Southlake', 'GB Southlake')
) as pair(liability_name, asset_name)
join public.assets a on a.name = pair.asset_name
where l.name = pair.liability_name
  and l.asset_id is null;
