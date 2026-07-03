-- T6: covering indexes for foreign keys on ACTIVE tables (per the live performance advisor's
-- unindexed_foreign_keys list). At the current data scale the impact is negligible, but these clear
-- the advisor and keep FK joins fast as the ledger grows. Dark/staged tables (transaction_splits,
-- payees, fixed_assets, account_reconciliations, sales_tax_periods) are intentionally left to land
-- with their consumers — see docs/Roadmap.md "Staged migrations".
--
-- IDEMPOTENT: create index if not exists.

create index if not exists ai_suggestions_suggested_category_id_idx
  on ai_suggestions (suggested_category_id);

create index if not exists classification_history_new_category_id_idx
  on classification_history (new_category_id);
create index if not exists classification_history_new_entity_id_idx
  on classification_history (new_entity_id);
create index if not exists classification_history_previous_category_id_idx
  on classification_history (previous_category_id);
create index if not exists classification_history_previous_entity_id_idx
  on classification_history (previous_entity_id);

create index if not exists classification_proposals_chosen_category_id_idx
  on classification_proposals (chosen_category_id);
create index if not exists classification_proposals_chosen_entity_id_idx
  on classification_proposals (chosen_entity_id);
create index if not exists classification_proposals_proposed_category_id_idx
  on classification_proposals (proposed_category_id);

create index if not exists import_batches_account_id_idx
  on import_batches (account_id);
create index if not exists import_batches_entity_id_idx
  on import_batches (entity_id);

create index if not exists qb_training_expenses_import_batch_id_idx
  on qb_training_expenses (import_batch_id);

create index if not exists raw_import_rows_account_id_idx
  on raw_import_rows (account_id);

create index if not exists self_rental_links_owner_entity_id_idx
  on self_rental_links (owner_entity_id);

create index if not exists suggestion_events_chosen_category_id_idx
  on suggestion_events (chosen_category_id);
create index if not exists suggestion_events_classification_id_idx
  on suggestion_events (classification_id);
create index if not exists suggestion_events_suggested_category_id_idx
  on suggestion_events (suggested_category_id);
create index if not exists suggestion_events_transaction_id_idx
  on suggestion_events (transaction_id);
