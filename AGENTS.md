# AGENTS.md — Hundie codebase guide

> **Audience:** Cursor (and other) agents starting a session in this repo.  
> **Goal:** Orient fast — what Hundie is, where code lives, and which deeper docs to open next.  
> **Not a substitute for:** reading the files you change.

---

## One line

Hundie is a **human-in-the-loop weekly classifier**: every bank/card charge gets an **entity** + **category** so books are CPA-ready. It is **not** a budgeting app and **not** a QuickBooks replacement — it works **with** QBO.

**Operator:** Alex classifies; AI suggests; humans confirm. Never silently rewrite books.

---

## Stack & live systems

| Piece | Detail |
|-------|--------|
| App | Next.js App Router, React, Tailwind, Vitest |
| DB / Auth | Supabase Postgres + Auth — project **`ihciuqpiavxhbulfkwod`** (“Hundie Project”, **ciutrust’s Org**, us-west-2) |
| Imports | CSV parsers (WF / Chase / Amex / Citi / Cap One) + Plaid sync + QB training CSV |
| GitHub | `ciutrust/hundie-cursor` |

**Supabase MCP:** must be authenticated as **ciutrust**, not Claudia’s org. Live ref is `ihciuqpiavxhbulfkwod` — a different paused “hundie” project may appear under Claudia and is **wrong**.

---

## Domain model (mental model)

```
Account (card/checking)  →  Transaction (amount, date, description)
                                ↓
                         Classification (entity_id, category_id, notes)
                                ↓
                         Category (per-entity chart, kind: expense|income|transfer|…)
```

- **Entities** — GBSL, Keller, Personal, Austin ACAA, Pflugerville (classifiable); trusts/dormant exist in registry only. See [docs/entities.md](docs/entities.md).
- **Category `kind`** — drives P&L. Runtime truth is [`lib/category-kind.ts`](lib/category-kind.ts) (keep [`scripts/lib/category-kind.mjs`](scripts/lib/category-kind.mjs) in sync). Transfers/funding/capital/liability stay **off** expense rollups.
- **Gross totals** — expense reports use `amount > 0` + expense kind. Refunds are separate negative rows (`Refund / credit`), not auto-netted.
- **CPA backlog** — null category **or** `Ask My Accountant` counts as unfinished (month close / entity readiness).

### Common category pairs (don’t confuse)

| Situation | Category |
|-----------|----------|
| Paying a card from checking | `Credit card payment` (transfer) |
| Voluntary refund / merchant credit | `Refund / credit` (transfer) |
| Member disputes a GBSL charge | `Chargeback` (expense, GBSL) |
| Stolen/unauthorized charge on *your* card | `Fraudulent charge` (expense) + issuer return → `Refund / credit` |
| Own savings ↔ checking (other leg untracked) | `Internal transfer` + intercompany “not tracked here” ack if needed |

Full operator cheat sheet: [docs/CLASSIFICATION.md](docs/CLASSIFICATION.md).

---

## Where code lives

| Path | Responsibility |
|------|----------------|
| [`app/`](app/) | Routes — `/review`, `/transactions`, `/reports/*`, `/month-close`, `/settings/connections` (Plaid), `/bills`, `/amazon` (Orders export desk), `/capture`, `/categories`, `/api/plaid/*` |
| [`components/review/`](components/review/) | Classify UI — list, bulk assign, suggestions, undo |
| [`components/intercompany/`](components/intercompany/) | Pairing review — linked pairs, one-sided legs, “not tracked here” |
| [`lib/actions/`](lib/actions/) | Server actions — reclassify, intercompany, proposals, bills |
| [`lib/queries/`](lib/queries/) | Read models for review, reports, intercompany, dashboard |
| [`lib/category-*.ts`](lib/) | Kind, expense predicates, review/AMA, descriptions |
| [`lib/suggestions/`](lib/suggestions/) | Deterministic category suggestions (QB training + history + amount) |
| [`lib/plaid/`](lib/plaid/) | Sync, mapping, ignored (“not tracked”) accounts |
| [`lib/intercompany-pairing.ts`](lib/intercompany-pairing.ts) | Pair kinds: owner funding, intercompany service, internal transfer |
| [`scripts/`](scripts/) | Imports, drift report, cleanup, verify — often plain Node `.mjs` |
| [`supabase/migrations/`](supabase/migrations/) | Schema + seed categories (apply to live; don’t assume MCP reaches ciutrust) |

---

## Critical invariants (don’t break)

1. **Human confirms** — suggestions and AI never auto-write final books without an assign/save path.
2. **Kind maps stay twin** — `lib/category-kind.ts` ↔ `scripts/lib/category-kind.mjs` (+ parity tests).
3. **Bulk `.in()` chunking** — large id lists must chunk (~200); see `lib/supabase/chunk.ts` / reclassify bulk.
4. **Migrations** — prefer new idempotent SQL; editing already-applied migrations won’t fix live DB.
5. **Secrets** — never commit `.env.local`, service role keys, EINs, or full financial dumps.
6. **Quicksilver date rule** — Cap One Quicksilver is GBSL through 2026-06-30, Personal from 2026-07-01 ([docs/QUICKSILVER-DATE-RULE.md](docs/QUICKSILVER-DATE-RULE.md)).

---

## How to run / verify

```bash
npm install && npm run dev          # http://localhost:3000
npm run verify:db                   # needs SUPABASE_SERVICE_ROLE_KEY in .env.local
npm test                            # vitest
npm run typecheck && npm run lint
```

Imports (dry-run by default unless `:apply`): `import:cards`, `import:qb-gbsl`, etc. See [RUN.md](RUN.md) and [package.json](package.json) scripts.

---

## Doc map (read in this order for most tasks)

| Doc | When |
|-----|------|
| **This file** | Every new agent session |
| [docs/CLASSIFICATION.md](docs/CLASSIFICATION.md) | Classifying, categories, kinds, cheat sheet |
| [docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md) | Entities, ownership, QB chart history, product intent (older planning dump — still useful) |
| [docs/entities.md](docs/entities.md) | Entity registry detail |
| [docs/SUPABASE.md](docs/SUPABASE.md) | RLS, migrations, keys, verify |
| [RUN.md](RUN.md) | Local run / smoke |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | What shipped recently |
| [docs/Backlog.md](docs/Backlog.md) | Open product work |
| [docs/AMAZON-DESK.md](docs/AMAZON-DESK.md) | Amazon Orders export → charge linking |
| [docs/AI-PRECLASSIFY.md](docs/AI-PRECLASSIFY.md) | AI suggestion pipeline |
| Plan/review docs under `docs/` | Historical; check date before treating as current truth |

---

## Typical task playbooks

**Add a category** — migration `INSERT` for entity slug(s) + `kind`; if non-expense, update both kind maps + tests; description in `lib/category-descriptions.ts`; note in `CLASSIFICATION.md`; apply to live `ihciuqpiavxhbulfkwod` if operators need it immediately.

**Classify / review UI** — start at `components/review/transaction-list.tsx` and `lib/actions/reclassify.ts`.

**Plaid “not tracked”** — ignored accounts in settings/connections; counterpart may be missing from ledger (e.g. Way2Save). Intercompany one-sided **ack** ≠ setting a category — still classify the visible leg (`Internal transfer`, etc.).

**Reports / P&L-ish totals** — follow `categoryKind` / `isOperatingExpense`; don’t invent new exclusion lists.

---

## When you reopen this chat

1. Skim this file.  
2. `git status` / current branch.  
3. Open the deep doc for the domain you’re touching (usually CLASSIFICATION or SUPABASE).  
4. Prefer reading call sites over inventing parallel patterns.
