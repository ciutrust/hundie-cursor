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
npm run verify:db
npm run import:cards:verify      # ~1,882 transactions, 17 accounts
npm run verify:amount-aware      # amount bucket ranking (Gracie Barra fixture)
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

## Docs for agents

| Doc | Purpose |
|-----|---------|
| [CLASSIFICATION.md](docs/CLASSIFICATION.md) | Categories, transfers, suggestion behavior, operator patterns |
| [PHASE3_PLAN.md](docs/PHASE3_PLAN.md) | Phase 3 scope, amount-aware rules (shipped) |
| [Backlog.md](docs/Backlog.md) | Prioritized work items |
| [PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md) | Architecture, QB import rules |

## What's next

Alex classifies backlog → reports polish → Keller QBO when access available. See [docs/PHASE3_PLAN.md](docs/PHASE3_PLAN.md).
