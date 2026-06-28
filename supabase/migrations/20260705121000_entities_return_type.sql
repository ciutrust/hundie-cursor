-- WS-F TAX-13 — entity federal return type. Conservative seed only.
--
-- FILE ONLY / STAGE-2: additive nullable column + CHECK + a guarded seed of the KNOWN return types.
-- Anything uncertain is left NULL for the CPA. entities has updated_at (20260625000000).

alter table entities add column if not exists return_type text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'entities_return_type_chk') then
    alter table entities add constraint entities_return_type_chk
      check (return_type is null or return_type in (
        'sch_c','sch_e','partnership_1065','s_corp_1120s','trust_1041','personal','none'
      ));
  end if;
end $$;

-- Seed the KNOWN ones (guarded on NULL; never overwrite a hand-set value).
update entities set return_type = 'sch_e', updated_at = now()
  where slug in ('acaa-austin','pflugerville') and return_type is null;
update entities set return_type = 'personal', updated_at = now()
  where slug = 'personal' and return_type is null;
update entities set return_type = 'trust_1041', updated_at = now()
  where slug in ('three-cities-trust','spendthrift-trust') and return_type is null;

-- TAX-13 CAVEAT: gbsl + keller left NULL — sch_c (disregarded SMLLC) vs s_corp_1120s depends on the
-- Form 2553 S-election; confirm before seeding. The TAX-03 Sch C line mapping still stands as the
-- most-likely target (if either is an S-corp the same expense buckets re-map to the 1120S, so no
-- chart rework is needed). Dormant LLCs (dallas-acaa, jiu-jitsu-coppell, acaa-management) left NULL
-- until activated.
