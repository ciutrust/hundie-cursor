-- Expense captures — receipts snapped at the counter, for the W2 reimbursement tracker.
--
-- WHY: a card charge lands days later as "SQ *XXXX 4471" and AC can't remember what the $47 was.
-- He captures vendor + amount + a photo + a note + GPS in the moment, then reconciles it against the
-- real charge when it posts. Cash spend never gets a charge at all, so a capture must also be able to
-- stand alone as the only record of that money.
--
-- SCOPE: this is 100% the W2-job (Cursor) reimbursement tracker. A capture is NOT a transaction and is
-- deliberately invisible to the ledger: fetchLedgerExpenseLines reads only `transactions` +
-- `transaction_splits`, so nothing here can reach a CPA/tax rollup. Inserting captures into
-- `transactions` would double-count the moment the bank row arrives (the CSV/Plaid double-source bug).
--
-- Conventions mirrored from the newer additive tables (bills, expense_reports): text + CHECK instead of
-- CREATE TYPE (no ALTER TYPE friction), nullable overlay FKs with ON DELETE SET NULL, partial indexes,
-- and an RLS set that withholds DELETE. Idempotent.

create table if not exists expense_captures (
  id uuid primary key default gen_random_uuid(),
  captured_at timestamptz not null default now(),

  vendor text,
  amount numeric(12, 2),
  note text,

  -- Nullable by design: a denied/timed-out geolocation must never block the save.
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  location_accuracy_m numeric(8, 1),

  -- Row is created BEFORE the photo lands, so the ~200-byte reconcile payload survives a failed upload.
  photo_path text,
  photo_status text not null default 'pending'
    check (photo_status in ('pending', 'uploaded', 'failed', 'none')),

  -- 'card' default: AC rarely pays cash. This is the discriminator that makes the double-count
  -- detectable — a 'card' capture is a PLACEHOLDER that must be reconciled when the charge posts,
  -- while 'cash' legitimately counts forever and never matches anything.
  capture_kind text not null default 'card' check (capture_kind in ('card', 'cash')),

  match_status text not null default 'unmatched'
    check (match_status in ('unmatched', 'matched', 'cash')),
  matched_transaction_id uuid references transactions(id) on delete set null,
  matched_at timestamptz,

  expense_report_id uuid references expense_reports(id) on delete set null,
  -- Per-line "Expensed" toggle (green/red). Cleared whenever expense_report_id changes, or a re-added
  -- line would arrive pre-green.
  expensed_at timestamptz,

  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 🔴 One charge can back at most ONE capture. Without this, a double-tap or a flaky phone submit makes
-- two captures both point at the same charge, both get suppressed, and the report silently undercounts.
-- This repo already shipped that exact bug against bills (lib/queries/bills.ts documents the runtime
-- workaround it needed); enforce it in the schema here instead of re-learning it.
create unique index if not exists expense_captures_matched_transaction_id_idx
  on expense_captures (matched_transaction_id)
  where matched_transaction_id is not null;

create index if not exists expense_captures_unmatched_idx
  on expense_captures (captured_at desc)
  where match_status = 'unmatched';

create index if not exists expense_captures_expense_report_id_idx
  on expense_captures (expense_report_id)
  where expense_report_id is not null;

-- Per-line toggle for real charges, and the report's PAID/UNPAID. Both nullable overlays, mirroring
-- split_at / plaid_removed_at / expense_report_id.
alter table transactions add column if not exists expensed_at timestamptz;
alter table expense_reports add column if not exists paid_at timestamptz;

create index if not exists transactions_expensed_at_idx
  on transactions (expensed_at)
  where expensed_at is not null;

alter table expense_captures enable row level security;

-- Mirrors the expense_reports / bills policy set: authenticated gets select/insert/update; DELETE is
-- withheld because deleting a capture must also drop its Storage object, so it goes through the
-- service-role action only. (Writes use service-role regardless; SELECT is genuinely needed because
-- lib/queries reads with the authenticated client.)
drop policy if exists "expense_captures authenticated select" on expense_captures;
drop policy if exists "expense_captures authenticated insert" on expense_captures;
drop policy if exists "expense_captures authenticated update" on expense_captures;

create policy "expense_captures authenticated select" on expense_captures
  for select to authenticated using (true);

create policy "expense_captures authenticated insert" on expense_captures
  for insert to authenticated with check (true);

create policy "expense_captures authenticated update" on expense_captures
  for update to authenticated using (true) with check (true);

-- Receipt photos. PRIVATE on purpose: a receipt is denser PII than the row behind it (card last-4,
-- address, line items, sometimes a signature), and 20260629140000 already removed anon SELECT from the
-- ledger — public images of the same data would contradict that. A public URL is also permanent and
-- unrevocable once it leaks. No storage policies are needed: uploads use a server-minted signed upload
-- URL and reads use server-minted signed download URLs, so the anon key gets no bucket access at all
-- (the storage twin of the bank_connections service-role posture).
-- png/heic/heif are allowed because downscaleImage deliberately returns the ORIGINAL file on several
-- paths (already small, re-encode came out bigger, or the codec wouldn't decode). Storage enforces this
-- allowlist on signed-URL uploads too, so a jpeg+webp-only list would 415 exactly those passthroughs and
-- lose the photo — while the row (and its whole reconcile payload) survived, which would be a confusing
-- half-failure. The 5MB limit is the real backstop against a client that skips the downscale.
--
-- `do update`, NOT `do nothing`: public/file_size_limit/allowed_mime_types are security- and
-- behavior-relevant, so a pre-existing 'receipts' bucket must be RECONCILED to this definition rather
-- than silently left as it was (e.g. public).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipts', 'receipts', false, 5242880,
  array['image/jpeg', 'image/webp', 'image/png', 'image/heic', 'image/heif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
