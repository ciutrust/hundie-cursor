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

## Phase 2 — Training · AI suggestions ← **current**

**Goal:** Suggest entity + category on new charges using GBSL QB history and Alex's confirmed classifications.

| Milestone | Status | Depends on |
|-----------|--------|------------|
| QB training data loaded | Done | — |
| Classified card ledger (Jan–Jun) | In progress (Alex classifying) | UI |
| AI suggestion v0 (vendor match, top 3) | **Next** | training + ledger |
| Suggestion UI on transaction detail | Not started | suggestion v0 |
| Progressive learning from confirmations | Not started | suggestion v0 |
| Keller QBO read | Blocked (no access yet) | — |
| Claudia auth | Not started | UI stable |

**Success criteria:** Recurring vendors auto-suggest correct GBSL category; Alex confirms or corrects. Ledger remains source of truth.

**Plan:** [PHASE2_PLAN.md](./PHASE2_PLAN.md)

---

## Phase 3 — Later · Banks, automation, CPA-ready

Bank import, QBO API, write-back, splits, CPA packet — after Phase 2 is reliable.

---

## Timeline

- **Jun 2026:** Schema, parsers, initial backfill, Phase 1 UI shipped
- **Now:** Alex classifies Jan–Jun; build Phase 2 suggestions in parallel
- **After Phase 2:** Claudia, Keller QBO, banks, QBO API
