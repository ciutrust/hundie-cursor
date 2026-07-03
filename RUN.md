# Run Hundie locally

## Prerequisites

- Node.js 20+
- `.env.local` with Supabase keys (see `.env.local.example`)

## Start the app

```bash
cp .env.local.example .env.local   # if not already configured
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Sign in

Supabase Auth (email/password or magic link). Review UI: `/review` — default month **June 2026**.

## Verify

```bash
npm run verify:db              # needs SUPABASE_SERVICE_ROLE_KEY after RLS lockdown
npm run import:cards:verify    # ~1,882 transactions, 17 accounts
npm run verify:amount-aware
npm run build
```

See [docs/SUPABASE.md](docs/SUPABASE.md) for RLS verification curl command.

## AI pre-classifier (optional)

Requires `ANTHROPIC_API_KEY` in `.env.local`. See [docs/AI-PRECLASSIFY.md](docs/AI-PRECLASSIFY.md).

```bash
npm test
npm run build
```

## Test plan

### Review UI

1. Sign in → `/review` — entity summary for June 2026 (expense totals exclude transfers)
2. Click **GBSL** or **Personal** — category breakdown + transaction list
3. **Search & filters** — text, amount, category, account
4. **Unclassified & AMA** — toggle next to Select all to focus backlog items
5. Click transaction → reclassify; check **Suggested categories** chips
6. Multi-select → **Assign category** for bulk
7. Save → totals refresh
8. **Find similar** — on any row click **Find similar** → the list narrows to that vendor and selects them all → pick a category → **Assign** (one click categorizes the whole vendor; the **Similar:** chip clears it)
9. **Mortgage / HELOC** — on a Pflugerville / Austin ACAA / Personal payment, reclassify → pick **Mortgage payment** or **HELOC payment** (whole payment, one line; the principal/interest split is QBO's job)

### AI Review — assign + override (`/review/ai`)

1. **Ask AI** on selected vendor groups (or all) → confirm the cost estimate → suggestions are saved (nothing is classified yet)
2. Each vendor-group line shows an editable **Entity** + **Category** (prefilled from the AI) and an **Assign** button; per-row checkboxes choose which rows get it (all selected by default)
3. **Keep** the AI pick → **Assign** (logs an accept). **Override** the category → **Assign** (saves your category, logs a reject of the AI's pick — and still trains the deterministic engine)
4. Check **Reports → AI suggestions** (`/reports/ai-suggestions`) — accept rate **by source** (AI vs the deterministic engine)

### Suggestions

- **GBSL:** blends QB training + your confirmed picks + amount buckets
- **Personal / rental:** confirmed history + amount buckets (no QB training)
- **Amount match:** after ≥2 classifications at same vendor+amount, chip shows "Amount match" badge
- **Gracie Barra test case:** classify 2× $125 → Software, 2× $850 → Franchise Fees; open a new $125 tx → Software should rank #1

See [docs/CLASSIFICATION.md](docs/CLASSIFICATION.md) for category cheat sheet.

## Import more CSVs

```bash
# Single account (dedupes automatically — safe to re-import same month)
node scripts/import-cards.mjs --account wf-keller-services-cc \
  --file ~/Downloads/WF-KellerServices-CreditCard-ChildAccount.csv
```

Keller CC: use **child** CSV; parent file is auto-merged (no duplicate charges).

### Dedupe (re-import safe)

Imports dedupe on **account + date + amount + normalized description** (not CSV row index). Re-running the same file or overlapping months is safe — existing rows are skipped.

```bash
npm run import:cards:csv-2025-2026           # preview (bare = dry-run)
npm run import:cards:csv-2025-2026:apply     # apply (writes)
```

If legacy duplicates are already in the ledger (e.g. same charge imported twice with different `import_hash`), run the one-time cleanup:

```bash
npm run cleanup:ledger-dupes                      # all entities (bare = dry-run)
npm run cleanup:ledger-dupes -- --entity keller   # preview keller (bare = dry-run)
npm run cleanup:ledger-dupes:apply -- --entity keller   # delete newer duplicate; keep oldest/categorized row
```

See [docs/CHANGELOG.md](docs/CHANGELOG.md) — Keller cleanup (130 rows, Jun 2026) applied in prod.

## Docs for agents

| Doc | Purpose |
|-----|---------|
| [CLASSIFICATION.md](docs/CLASSIFICATION.md) | Categories, transfers, suggestion behavior, operator patterns |
| [PHASE3_PLAN.md](docs/PHASE3_PLAN.md) | Phase 3 scope, amount-aware rules (shipped) |
| [Backlog.md](docs/Backlog.md) | Prioritized work items |
| [SUPABASE.md](docs/SUPABASE.md) | RLS security, migrations, verify curl |
| [PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md) | Architecture, QB import rules |

## What's next

Alex classifies backlog → reports polish → Keller QBO when access available. See [docs/PHASE3_PLAN.md](docs/PHASE3_PLAN.md).
