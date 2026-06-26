-- Security: revoke anonymous read access to the financial ledger.
--
-- Context: Hundie is deployed on Vercel; the publishable (anon) key is in the browser bundle.
-- Prior migrations granted SELECT to anon + authenticated with USING (true), exposing the full
-- ledger to anyone with the anon key.
--
-- Fix: authenticated-only SELECT. Single-tenant today (Alex, Claudia — both trusted sign-ins).
-- Per-user / per-row isolation is a future step if the app becomes multi-tenant (no user_id cols yet).
--
-- Unchanged: RLS stays enabled; existing authenticated INSERT/UPDATE policies; service_role
-- import scripts bypass RLS as before.

-- entities
drop policy if exists "Anyone can read entities" on public.entities;
create policy "Authenticated users can read entities"
  on public.entities for select
  to authenticated
  using (true);

-- categories
drop policy if exists "Anyone can read categories" on public.categories;
create policy "Authenticated users can read categories"
  on public.categories for select
  to authenticated
  using (true);

-- import_batches (same anon leak class; not used by UI but contains import metadata)
drop policy if exists "Anyone can read import_batches" on public.import_batches;
create policy "Authenticated users can read import_batches"
  on public.import_batches for select
  to authenticated
  using (true);

-- qb_training_expenses
drop policy if exists "Anyone can read qb_training_expenses" on public.qb_training_expenses;
create policy "Authenticated users can read qb_training_expenses"
  on public.qb_training_expenses for select
  to authenticated
  using (true);

-- accounts
drop policy if exists "Anyone can read accounts" on public.accounts;
create policy "Authenticated users can read accounts"
  on public.accounts for select
  to authenticated
  using (true);

-- transactions
drop policy if exists "Anyone can read transactions" on public.transactions;
create policy "Authenticated users can read transactions"
  on public.transactions for select
  to authenticated
  using (true);

-- classifications
drop policy if exists "Anyone can read classifications" on public.classifications;
create policy "Authenticated users can read classifications"
  on public.classifications for select
  to authenticated
  using (true);

-- raw_import_rows
drop policy if exists "Anyone can read raw_import_rows" on public.raw_import_rows;
create policy "Authenticated users can read raw_import_rows"
  on public.raw_import_rows for select
  to authenticated
  using (true);

-- classification_history
drop policy if exists "Anyone can read classification_history" on public.classification_history;
create policy "Authenticated users can read classification_history"
  on public.classification_history for select
  to authenticated
  using (true);

-- suggestion_events
drop policy if exists "Anyone can read suggestion_events" on public.suggestion_events;
create policy "Authenticated users can read suggestion_events"
  on public.suggestion_events for select
  to authenticated
  using (true);
