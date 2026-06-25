-- Add Wells Fargo Personal Checking, Anita Checking, and GBSL Credit Card accounts

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
    ('WF Personal Checking', 'wf-personal-checking', 'checking', 'wells_fargo', 'personal', '[]', false),
    ('WF Anita Checking', 'wf-anita-checking', 'checking', 'wells_fargo', 'acaa-austin', '[]', false),
    ('WF GBSL Credit Card', 'wf-gbsl-cc', 'credit_card', 'wells_fargo', 'gbsl', '[]', false)
) as v(display_name, slug, account_type, issuer_parser, entity_slug, date_rules, mixed_use)
join entities e on e.slug = v.entity_slug
on conflict (slug) do nothing;
