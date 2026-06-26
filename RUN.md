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

## Verify data

```bash
npm run verify:db
npm run import:cards:verify   # ~1,882 transactions, 17 accounts
npm run build
```

## Test plan (Phase 1)

1. Sign in → `/review` — entity summary for June 2026
2. Click **Keller** or **GBSL** — transaction list + category breakdown
3. **Search & filters** — text, amount (equals/more/less), category multiselect, account multiselect
4. Click transaction → reclassify entity + category (GBSL QB categories)
5. Multi-select → **Assign category** for bulk
6. Save → totals refresh on back/navigate

## Import more CSVs

```bash
# Single account (dedupes automatically — safe to re-import same month)
node scripts/import-cards.mjs --account wf-keller-services-cc \
  --file ~/Downloads/WF-KellerServices-CreditCard-ChildAccount.csv
```

Keller CC: use **child** CSV; parent file is auto-merged (no duplicate charges).

## Docs for agents

- **Classification (categories, transfers, patterns):** [docs/CLASSIFICATION.md](docs/CLASSIFICATION.md)
- **Phase 3 plan + amount-aware rules scope:** [docs/PHASE3_PLAN.md](docs/PHASE3_PLAN.md)
- **Backlog:** [docs/Backlog.md](docs/Backlog.md)

## What's next

Phase 3 — learning loop + Alex classifying backlog: [docs/PHASE3_PLAN.md](docs/PHASE3_PLAN.md)
