# Build handoff

> **Phase 1–2:** Complete. **Phase 3:** In progress — amount-aware suggestions on `feature/amount-aware-suggestions`.
> See [RUN.md](../RUN.md) to start the app · [CLASSIFICATION.md](./CLASSIFICATION.md) for agents.

---

## Current state (Jun 2026)

Alex can:

```bash
npm install && npm run dev
# → http://localhost:3000 → sign in → /review (default June 2026)
```

- Monthly entity summary (expense totals exclude transfers/refunds)
- Drill-down → search/filter → **Unclassified & AMA** toggle → reclassify single or bulk
- **Suggestions:** QB training (GBSL) + confirmed history + amount buckets
- Category charts: GBSL (QB), Personal (28), Austin ACAA + Pflugerville (Schedule E)

**Ledger:** ~1,882 transactions · 17 accounts · Supabase `ihciuqpiavxhbulfkwod`

**Branch:** `feature/amount-aware-suggestions` — amount-aware ranking + category chart gaps

---

## Do not redo

- QB import, initial card backfill, Next.js scaffold, auth, core review UI
- Phase 2 suggestion pipeline (extend, don't replace)
- Category migrations through `20260629120000`

---

## Keller import notes

- **WF Keller CC:** Import **child** CSV; parent CSV auto-merged for parent-only rows (late fees)
- **Re-import:** Safe — dedupe on account + date + amount + normalized description (not CSV row index)
- **Legacy dupes:** `npm run cleanup:ledger-dupes -- --entity keller` (bare = dry-run) then `npm run cleanup:ledger-dupes:apply -- --entity keller` if needed (130 Keller dupes cleaned Jun 2026)

---

## Verify

```bash
npm run verify:db
npm run import:cards:verify
npm run verify:amount-aware
npm run build
```

---

## What's next

1. Alex classifies Jan–Jun backlog
2. Reports CSV export polish
3. Keller QBO when access available
4. Merge `feature/amount-aware-suggestions` → `main`

**Plans:** [PHASE3_PLAN.md](./PHASE3_PLAN.md) · [Backlog.md](./Backlog.md)

**Not yet:** Keller QBO, Claudia auth, pgvector, write-back, bank automation.
