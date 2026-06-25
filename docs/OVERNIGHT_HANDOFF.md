# Build handoff

> **Phase 1:** Complete. See [RUN.md](../RUN.md) to start the app.
> **Phase 2:** See [PHASE2_PLAN.md](./PHASE2_PLAN.md) — AI category suggestions (next).

---

## Phase 1 — done ✅

Alex can:

```bash
npm install && npm run dev
# → http://localhost:3000 → sign in → /review (default June 2026)
```

- Monthly entity summary (GBSL, Keller, Personal, Pflugerville, acaa-austin, Unclassified)
- Drill-down → search/filter (text, amount, category, account) → reclassify single or bulk
- GBSL categories from QB chart; Keller/Personal categories stubbed until native chart exists

**Ledger:** ~1,882 transactions · 17 accounts · Supabase `ihciuqpiavxhbulfkwod`

**Do not redo:** QB import, initial 13-account backfill, Next.js scaffold, auth, core review UI.

---

## Keller import notes (Jun 2026)

- **WF Keller CC:** Import **child** CSV; parent CSV auto-merged for parent-only rows (late fees). **72 dupes avoided** — do not import parent as separate account.
- **Checking:** Outflows only (same as other WF checking imports).
- **Re-import:** Same month twice → existing rows skipped via `import_hash` dedupe.

---

## Phase 2 — next

Read [PHASE2_PLAN.md](./PHASE2_PLAN.md). Build AI suggestion v0 on transaction detail (GBSL, top 3 from QB training, human confirms).

**Not yet:** Keller QBO, Claudia auth, pgvector, write-back, bank automation.

---

## Verify

```bash
npm run verify:db
npm run import:cards:verify   # ~1,882 tx across 17 accounts
npm run build
```

---

## Suggested agent prompt (Phase 2)

```
Read docs/PHASE2_PLAN.md and docs/PROJECT_CONTEXT.md.

Implement Phase 2 v0: category suggestions on transaction reclassify dialog.
GBSL only. Top 3 from qb_training_expenses vendor/description match. Human confirms — never auto-apply.
Follow build order in PHASE2_PLAN.md. npm run build must pass.
Do not start Keller QBO, Claudia auth, or pgvector.
```
