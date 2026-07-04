# Hundie Roadmap

Phased plan aligned with [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md).

**Operators:** Alex classifies now · Claudia joins later · AI suggests, humans confirm always.

---

## Phase 1 — Card backfill + review UI ✅ (shipped)

**Goal:** Import Jan–Jun 2026 charges and classify them in a monthly review UI.

| Milestone | Status |
|-----------|--------|
| Entity registry + ledger schema | Done |
| QB categories + training import | Done |
| Card CSV import (17 accounts, ~1,882 tx) | Done |
| Keller Services WF accounts + parent/child dedupe | Done |
| Classification audit history | Done |
| Next.js monthly review UI | Done |
| Search, bulk reclassify, category/account filters | Done |
| Manual intercompany flag (±3-day mirror window, C19) | Done |

**Alex can:** run locally → sign in → open a month → see entity totals → search/filter → reclassify single or bulk → totals refresh.

See [RUN.md](../RUN.md) for start instructions.

---

## Phase 2 — Training · AI suggestions ✅ (shipped)

**Goal:** Suggest entity + category on new charges using GBSL QB history and Alex's confirmed classifications.

| Milestone | Status | Depends on |
|-----------|--------|------------|
| QB training data loaded | Done | — |
| Classified card ledger (Jan–Jun) | In progress (Alex classifying) | UI |
| AI suggestion v0 (vendor match, top 3) | Done | training + ledger |
| Suggestion UI on transaction detail + bulk | Done | suggestion v0 |
| Personal categories + monthly matrix + backlog nav | Done | UI |
| Progressive learning from confirmations | Done (Phase 3) | suggestion v0 |
| Keller QBO read | Blocked (no access yet) | — |
| Claudia auth | Not started | UI stable |

**Plan:** [PHASE2_PLAN.md](./PHASE2_PLAN.md) · [PHASE3_PLAN.md](./PHASE3_PLAN.md)

---

## Phase 3 — Learning loop + category trends ← **current**

**Goal:** Personal suggestions from confirmed history, category × month trends, path to CPA export, complete category charts for classification backlog.

| Milestone | Status |
|-----------|--------|
| Personal vendor suggestions (confirmed history) | Done |
| Category × month matrix on entity page | Done |
| Suggestion accept/reject log (`suggestion_events`) | Done |
| Unclassified & AMA filter + non-expense totals | Done |
| GBSL/rental/Personal category gaps (transfers, fees, interest) | Done |
| Reports + CSV export | Partial |
| Amount-aware rules (Gracie Barra amount bands) | Done |
| Mortgage/HELOC payment categories (whole payment, no P&I split — that's QBO) | Done |
| AI Review inline assign + category override (override trains the engine) | Done |
| Find-similar bulk categorize on review list | Done |
| Review dashboard performance pass (dedup + parallel queries + indexes) | Done |
| 2026-07-01 review — Track 1 correctness/architecture hardening (C4–C21) | Done (2026-07-03, PR #10) |

**Hardening:** the 2026-07-01 multi-agent review's Track 1 (17 correctness/architecture findings, C4–C21) shipped 2026-07-03 — reversed-charge exclusion, orphan-aware close, re-link/CSV overlap guards, income-capture parity, proposal-commit correctness, and a `transaction_history` audit trail. Still open: Track 2 (security) + Track 3 (tooling) from that review, and the separate [PERF-REVIEW-2026-07-02.md](./PERF-REVIEW-2026-07-02.md) (74 findings, incl. the bulk-`.in()` URL 400s).

**Plans:** [PHASE3_PLAN.md](./PHASE3_PLAN.md) · [CLASSIFICATION.md](./CLASSIFICATION.md)

---

## Phase 4 — Later · Banks, automation, CPA-ready

Bank import, QBO API, write-back, splits, CPA packet — after Phase 2 is reliable.

### Staged migrations (schema ahead of consumers)

Several Phase-4 tables already exist in the DB (migrations applied) but have **no application code yet** — intentional pre-staging, not dead schema. Advisors/reviews will flag them (`unused_index`, `unindexed_foreign_keys` on the dark tables, `rls_policy_always_true`) until the feature lands; that's expected. Land each table's covering indexes + any policy tightening **with its consumer**, not before:

- `transaction_splits` (`20260705122000`) — needs the sum-to-parent invariant + rollup exclusion before any writer (C18; Icebox in Backlog). Its two FK indexes were deliberately left off in the Track-2 FK pass.
- `payees` / `payee_aliases` (`20260706120000_create_payees`) — payee normalization.
- `fixed_assets` (`20260706121000`) — depreciation schedule.
- `account_reconciliations` (`20260706122000`) — statement reconciliation.
- `sales_tax_periods` (`20260706123000`) — sales-tax filing periods.

---

## Timeline

- **Jun 2026:** Schema, parsers, initial backfill, Phase 1 UI shipped
- **Jun 2026:** Phase 2 suggestions + Phase 3 learning loop, category charts, amount-aware rules
- **Now:** Month/Tax close readiness views, Mortgage/HELOC categories, AI-Review inline assign + override, find-similar bulk categorize, dashboard speedup; Alex classifies Jan–Jun backlog; reports polish
- **Jul 2026 (review remediations, shipped):** Track 1 correctness C4–C21 (PR #10); Track 2/3 security + tooling S2–S12/T4–T9 + missing categories (PR #11); performance review — the bulk-`.in()` URL bug, silent 1000-row commit cap, live 400/406, sidebar/render costs, DDL indexes (PR #12). See [CHANGELOG.md](./CHANGELOG.md).
- **Later:** Claudia, Keller QBO, banks, QBO API
