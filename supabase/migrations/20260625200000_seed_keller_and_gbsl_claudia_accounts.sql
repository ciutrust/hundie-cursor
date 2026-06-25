-- Keller Services + WF GBSL Claudia accounts for Jan–Jun 2026 backfill

insert into accounts (display_name, slug, account_type, issuer_parser, default_entity_id, date_rules, mixed_use)
select
  v.display_name,
  v.slug,
  v.account_type::account_type,
  v.issuer_parser,
  e.id,
  v.date_rules::jsonb,
  v.mixed_use
from (
  values
    ('WF Keller Services Credit Card', 'wf-keller-services-cc', 'credit_card', 'wells_fargo', 'keller', '[]', false),
    ('WF Keller Services Checking', 'wf-keller-services-checking', 'checking', 'wells_fargo', 'keller', '[]', false),
    ('WF Keller JRoots Checking', 'wf-keller-jroots-checking', 'checking', 'wells_fargo', 'keller', '[]', false),
    ('WF GBSL Claudia Credit Card', 'wf-gbsl-claudia-cc', 'credit_card', 'wells_fargo', 'gbsl', '[]', false)
) as v(display_name, slug, account_type, issuer_parser, entity_slug, date_rules, mixed_use)
join entities e on e.slug = v.entity_slug
on conflict (slug) do nothing;
