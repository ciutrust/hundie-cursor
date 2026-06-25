# Changelog

All notable changes to the Hundie project. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **Phase 1 review UI** — Next.js App Router app at `/review` with Supabase Auth, monthly entity summary, drill-down, single + bulk reclassify
- **Search & filters** — text search, amount operators (equals / more than / less than), category multiselect, account multiselect (collapsible panel)
- **Classification audit** — `classification_history` table + trigger on reclassify; RLS write policy for authenticated users
- **Keller Services data** — 4 new WF accounts seeded; 152 transactions imported (130 Keller entity)
- **WF parent/child CC dedupe** — Keller Signify master/subaccount merge on import (child + parent-only rows such as late fees; no double-count)
- **Account seeds (batch 2)** — `wf-keller-services-cc`, `wf-keller-services-checking`, `wf-keller-jroots-checking`, `wf-gbsl-claudia-cc`

### Changed

- Ledger now **~1,882 transactions** across **17 accounts** (was 1,730 / 13 accounts)
- `npm run dev`, `npm run build` — Next.js alongside existing import scripts

### Documentation

- [RUN.md](../RUN.md) — local start + test plan
- [docs/PHASE2_PLAN.md](./PHASE2_PLAN.md) — AI suggestion v0 spec (Phase 2 next)
- Updated Roadmap, Backlog, OVERNIGHT_HANDOFF

### Not yet built (Phase 2+)

- AI category suggestions from QB training + confirmed ledger
- Keller QBO import (Alex will provide access later)
- Manual intercompany flag (GBSL → Anita lease)
- Remaining card accounts (Home Depot, Best Buy, etc.)
- Hundie-native categories for Personal / rental entities

---

## [0.1.0] — 2026-06-26 (Phase 1)

### Added

- **Project planning doc** — `docs/PROJECT_CONTEXT.md`
- **Entity registry** — 10 entities (5 classifiable)
- **QB-aligned schema** — `categories`, `qb_training_expenses` (~3,577 GBSL training rows)
- **Card ledger schema** — `accounts`, `transactions`, `classifications`, `raw_import_rows`
- **Card CSV parsers** — Wells Fargo, Chase, Amex, Citi, Capital One
- **Card import pipeline** — `import:cards`, dry-run, verify, SQL batch generation
- **Initial backfill** — 1,730 transactions, Jan–Jun 2026, 13 accounts

---

## [0.0.1] — 2026-06-25

Initial repository setup — GitHub repo, Supabase project, entities migration, verify scripts.

[Unreleased]: https://github.com/ciutrust/hundie-cursor/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ciutrust/hundie-cursor/compare/v0.0.1...v0.1.0
[0.0.1]: https://github.com/ciutrust/hundie-cursor/releases/tag/v0.0.1
