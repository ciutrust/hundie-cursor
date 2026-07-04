-- Performance indexes — Review 2026-07-02 (D1, D2, D4).

-- D1: the hot proposals queries all filter (entity_slug, status) and order by (vendor_key, id), but
-- the existing indexes are keyed on entity_id — never matched, so the advisor reports them unused and
-- every proposals count/fetch seq-scans. Replace with a composite matching the real access path, then
-- drop the two mismatched entity_id-keyed indexes.
create index if not exists classification_proposals_slug_status_idx
  on classification_proposals (entity_slug, status, vendor_key, id);
drop index if exists classification_proposals_entity_status_idx;
drop index if exists classification_proposals_vendor_idx;

-- D2: the suggestion engine runs leading-wildcard ILIKE scans (%token%) — unindexable by btree, up to
-- 10 OR arms × ~50 vendors per Classify render. pg_trgm GIN indexes make them indexable and stop the
-- linear degradation as the ledger grows. Columns match the ILIKE sites in lib/actions/suggestions.ts.
create extension if not exists pg_trgm;
create index if not exists transactions_description_trgm_idx
  on transactions using gin (description gin_trgm_ops);
create index if not exists transactions_vendor_trgm_idx
  on transactions using gin (vendor gin_trgm_ops);
create index if not exists qb_training_expenses_vendor_name_trgm_idx
  on qb_training_expenses using gin (vendor_name gin_trgm_ops);
create index if not exists qb_training_expenses_description_trgm_idx
  on qb_training_expenses using gin (description gin_trgm_ops);

-- D4: drop dead indexes on <30-row tables (advisor-confirmed unused; a seq scan always wins at that
-- size). Reversible — recreate from the original migrations if ever needed.
drop index if exists entities_status_idx;
drop index if exists entities_classifiable_idx;
drop index if exists accounts_default_entity_id_idx;
drop index if exists accounts_issuer_parser_idx;
