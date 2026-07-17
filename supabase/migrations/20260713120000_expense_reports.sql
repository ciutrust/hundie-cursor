-- Expense reports — bundle a trip's charges into a numbered, named report.
--
-- Motivating case: AC files W2 job-travel expense reports (e.g. "Workidate Sacramento"). He needs to
-- pull a trip's charges across several cards into one report, then book them as the reimbursed-W2
-- wash (Personal / "Job W2 Expenses"). Today he logs into each card issuer separately to find them.
--
-- Membership is a NULLABLE OVERLAY FK on transactions (transactions.expense_report_id), mirroring the
-- existing split_at / plaid_removed_at overlay pattern: additive, nullable, partial-indexed. It keeps
-- a transaction in at most one report (single column = single membership, no join table needed), and
-- deleting a report RELEASES its transactions (on delete set null) rather than touching bank rows —
-- the transaction is bank truth; the report is an overlay on top of it. Idempotent.

create table if not exists expense_reports (
  id uuid primary key default gen_random_uuid(),
  -- Display is zero-padded in the UI (1 -> "0001"); the column stays a plain incrementing int.
  number int generated always as identity,
  name text not null,
  notes text,
  created_by text,
  created_at timestamptz not null default now()
);

create unique index if not exists expense_reports_number_idx on expense_reports (number);

alter table transactions
  add column if not exists expense_report_id uuid references expense_reports(id) on delete set null;

create index if not exists transactions_expense_report_id_idx
  on transactions (expense_report_id)
  where expense_report_id is not null;

alter table expense_reports enable row level security;

-- Single-tenant app (Alex is the only user), mirroring the bills/payees policy set: authenticated gets
-- select/insert/update, and DELETE is deliberately WITHHELD. Deleting a report releases every one of its
-- transactions (ON DELETE SET NULL), so it goes through the service-role action only — a stray client
-- call can't quietly unfile a whole trip. (An earlier revision of this file granted `for all`; the
-- explicit drops below make the tightening idempotent on a DB that already ran it.)
drop policy if exists "expense_reports authenticated all" on expense_reports;
drop policy if exists "expense_reports authenticated select" on expense_reports;
drop policy if exists "expense_reports authenticated insert" on expense_reports;
drop policy if exists "expense_reports authenticated update" on expense_reports;

create policy "expense_reports authenticated select" on expense_reports
  for select to authenticated using (true);

create policy "expense_reports authenticated insert" on expense_reports
  for insert to authenticated with check (true);

create policy "expense_reports authenticated update" on expense_reports
  for update to authenticated using (true) with check (true);
