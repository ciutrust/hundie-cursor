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
| Manual intercompany flag | Not started |

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

**Plans:** [PHASE3_PLAN.md](./PHASE3_PLAN.md) · [CLASSIFICATION.md](./CLASSIFICATION.md)

---

## Phase 4 — Later · Banks, automation, CPA-ready

Bank import, QBO API, write-back, splits, CPA packet — after Phase 2 is reliable.

---

## Timeline

- **Jun 2026:** Schema, parsers, initial backfill, Phase 1 UI shipped
- **Jun 2026:** Phase 2 suggestions + Phase 3 learning loop, category charts, amount-aware rules
- **Now:** Mortgage/HELOC categories, AI-Review inline assign + override, find-similar bulk categorize, dashboard speedup; Alex classifies Jan–Jun backlog; reports polish
- **Later:** Claudia, Keller QBO, banks, QBO API
