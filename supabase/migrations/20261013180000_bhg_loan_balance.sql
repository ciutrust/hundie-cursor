-- Contract 1208149. The April 18, 2025 BHG schedule bills on the 10th.
-- Payments through October 5, 2026 are the September 10 payment. Balance after that row.

update public.liabilities
set
  name = 'BHG Business Loan — GB Southlake',
  current_balance = 70501.64,
  interest_rate = 11.99,
  notes = 'Contract 1208149. 11.99%, $5,810.04 due the 10th. Balance after the 9/10/2026 payment; payments treated as made through 10/5/2026. Schedule from BHG on 4/18/2025, not a payoff quote.',
  updated_at = now()
where name = 'CNB Business Loan — GB Southlake';
