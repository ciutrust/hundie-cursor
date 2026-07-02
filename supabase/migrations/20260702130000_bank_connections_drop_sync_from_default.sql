-- The current_date default silently set the Plaid cutover to the LINK date, dropping the gap
-- between the CSV's last row and the link date. The cutover is now derived in map-accounts as
-- MAX(transaction_date)+1 of the mapped accounts (or an operator override). Remove the default so
-- an unmapped connection stays NULL and run-sync's null-guard (fall back to today + warn) applies.
alter table bank_connections alter column sync_from_date drop default;

-- C2: run-sync writes status 'needs_mapping' when a sync finds unmapped Plaid accounts and HOLDS
-- the forward-only cursor so their rows re-deliver after mapping. The status column is the
-- connection_status enum, so the value must exist before that write can succeed.
alter type connection_status add value if not exists 'needs_mapping';
