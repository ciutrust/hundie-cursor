-- Stage 2 — let a proposal reassign a transaction to a DIFFERENT entity (the main use case:
-- a business expense paid on a personal card → move Personal → GBSL). When chosen_entity_id is set,
-- commit writes the classification under that entity (and chosen_category_id must belong to it).
alter table classification_proposals
  add column if not exists chosen_entity_id uuid references entities (id) on delete set null;
