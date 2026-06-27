-- Mortgage payments are tracked as a single "Mortgage payment" (the principal/interest split is
-- done in QuickBooks, not here). Hide the principal/interest split categories so they no longer
-- appear in the category pickers. The few Austin ACAA rows that used "Mortgage principal payment"
-- were re-pointed to "Mortgage payment". "Mortgage payment" and "HELOC payment" stay active.

update categories
set is_active = false
where full_path ilike 'Mortgage principal%'
   or full_path ilike 'Mortgage interest%';
