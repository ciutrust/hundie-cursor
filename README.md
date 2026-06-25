# Hundie

Weekly transaction classifier for multi-entity bookkeeping and taxes.

Hundie sorts every charge across businesses, rental properties, and personal life into the right **entity** and **tax category** — a little each week — so that at tax time your books are already clean, per-entity, and ready for the CPA.

**Status:** Phase 1 shipped — review UI live. Phase 2 (AI suggestions) next.

## Stack

- **App:** Next.js App Router, Tailwind, Supabase Auth
- **Database:** [Supabase](https://supabase.com) (Postgres) — ~1,882 tx, 17 accounts
- **GitHub:** `hundie-cursor` (ciutrust account)

## Quick start

```bash
cd hundie-cursor
cp .env.local.example .env.local   # fill in Supabase keys from dashboard
npm install
npm run dev                        # http://localhost:3000
npm run verify:db                  # confirm Supabase connection
```

See [RUN.md](RUN.md) for sign-in and test plan.

## Supabase project

| Setting | Value |
|---------|-------|
| Project name | Hundie Project |
| Project ref | `ihciuqpiavxhbulfkwod` |
| Region | us-west-2 |
| Dashboard | https://supabase.com/dashboard/project/ihciuqpiavxhbulfkwod |

## Docs

- [Run locally](RUN.md)
- [Phase 2 plan](docs/PHASE2_PLAN.md)
- [Project context & handoff](docs/PROJECT_CONTEXT.md)
- [Roadmap](docs/Roadmap.md)
- [Backlog](docs/Backlog.md)
- [Changelog](docs/CHANGELOG.md)
- [Entity registry](docs/entities.md)
- [Supabase setup](docs/SUPABASE.md)

## MVP scope

1. ✅ Import card/checking CSVs (Jan–Jun 2026)
2. ✅ Monthly entity review + reclassify
3. 🔄 AI category suggestions (Phase 2 — [plan](docs/PHASE2_PLAN.md))
4. GBSL QuickBooks training data loaded; Keller QBO later
