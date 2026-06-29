-- WS-F TAX-14 — Texas franchise (margin) tax category per LLC entity.
--
-- FILE ONLY / STAGE-2. DISTINCT from the GBSL "Franchise Fees" category (the Gracie Barra royalty).
-- Most small LLCs owe $0 but still file the No-Tax-Due / annual report. tax_line left NULL: the federal
-- line depends on each entity's return type (Sch C L23 vs Sch E L16 vs 1065/1120S) — the CPA maps it
-- once TAX-13 return_type is confirmed. kind set explicitly = expense (so the categories.kind column
-- stays coherent for SQL-side rollups; runtime kind still reads lib/category-kind.ts).
--
-- Excludes pflugerville ("Pflugerville Rental", not named an LLC). Add it later if confirmed LLC-held.

insert into categories (entity_id, name, full_path, kind, is_active)
select e.id, 'Texas franchise tax (margin tax)', 'Texas franchise tax (margin tax)', 'expense', true
from entities e
where e.slug in ('gbsl','keller','acaa-austin','dallas-acaa','jiu-jitsu-coppell','acaa-management')
on conflict (entity_id, full_path) do nothing;
