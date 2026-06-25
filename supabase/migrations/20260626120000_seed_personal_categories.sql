-- Personal entity category chart (tax-aware household classification)

insert into categories (entity_id, name, full_path, is_active)
select e.id, v.name, v.full_path, true
from entities e
cross join (
  values
    -- Everyday personal (not deductible)
    ('Groceries & household', 'Groceries & household'),
    ('Dining & entertainment', 'Dining & entertainment'),
    ('Clothing & personal care', 'Clothing & personal care'),
    ('Personal travel & vacation', 'Personal travel & vacation'),
    ('Subscriptions & memberships', 'Subscriptions & memberships'),
    ('Gifts (non-charitable)', 'Gifts (non-charitable)'),
    ('Pets', 'Pets'),
    ('Auto & fuel (personal use)', 'Auto & fuel (personal use)'),
    ('Home maintenance & improvements', 'Home maintenance & improvements'),
    ('Utilities — primary residence', 'Utilities — primary residence'),
    ('Insurance — personal', 'Insurance — personal'),
    ('Childcare & family', 'Childcare & family'),
    ('Education — personal', 'Education — personal'),
    ('Hobbies & recreation', 'Hobbies & recreation'),
    -- Tax-related (Schedule A candidates — confirm with CPA)
    ('Medical & dental', 'Medical & dental'),
    ('Charitable contributions', 'Charitable contributions'),
    ('State & local taxes (SALT)', 'State & local taxes (SALT)'),
    ('Mortgage interest — primary home', 'Mortgage interest — primary home'),
    ('Investment fees & tax prep', 'Investment fees & tax prep'),
    ('Casualty & theft loss', 'Casualty & theft loss'),
    -- Reclassify to another entity
    ('→ GBSL business expense', '→ GBSL business expense'),
    ('→ Keller business expense', '→ Keller business expense'),
    ('→ Austin ACAA (136 Anita)', '→ Austin ACAA (136 Anita)'),
    ('→ Pflugerville rental', '→ Pflugerville rental'),
    ('Mixed / pending allocation', 'Mixed / pending allocation'),
    -- Non-expense
    ('Credit card payment', 'Credit card payment'),
    ('Transfer / Zelle (personal)', 'Transfer / Zelle (personal)'),
    ('Refund / credit', 'Refund / credit'),
    ('Intercompany — pending', 'Intercompany — pending')
) as v(name, full_path)
where e.slug = 'personal'
on conflict (entity_id, full_path) do nothing;
