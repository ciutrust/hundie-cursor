-- Wallet: plastic cards and bank products on Settings → Accounts.
-- Non-secret display fields live on wallet_items (last4, expiry, name). Full PAN, CVV, routing,
-- and account numbers live in wallet_secrets as AES-256-GCM ciphertext (WALLET_VAULT_ENC_KEY).
--
-- SECURITY: RLS enabled, no anon/authenticated policies -> service-role only, same as
-- bank_connections / plaid_account_links. Do not put PAN/CVV on public.accounts
-- (authenticated SELECT already exists there).

create table if not exists wallet_items (
  id uuid primary key default gen_random_uuid(),
  account_id uuid unique references accounts (id) on delete set null,
  kind text not null check (kind in ('card', 'bank')),
  display_name text not null,
  slug text not null unique,
  issuer_parser text not null,
  account_type text not null check (account_type in ('credit_card', 'checking', 'savings')),
  last4 text,
  expiry text,
  network text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists wallet_items_kind_idx on wallet_items (kind);

create table if not exists wallet_secrets (
  wallet_item_id uuid primary key references wallet_items (id) on delete cascade,
  ciphertext text not null,
  key_fingerprint text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table wallet_items enable row level security;
alter table wallet_secrets enable row level security;
-- Intentionally no policies: deny-all for anon/authenticated; service-role bypasses RLS.

insert into wallet_items (
  account_id,
  kind,
  display_name,
  slug,
  issuer_parser,
  account_type,
  last4
)
select
  a.id,
  case when a.account_type = 'credit_card' then 'card' else 'bank' end,
  a.display_name,
  a.slug,
  a.issuer_parser,
  a.account_type::text,
  nullif(right(regexp_replace(coalesce(pal.plaid_mask, ''), '[^0-9]', '', 'g'), 4), '')
from accounts a
left join plaid_account_links pal on pal.account_id = a.id
where not exists (
  select 1 from wallet_items w where w.account_id = a.id
);
