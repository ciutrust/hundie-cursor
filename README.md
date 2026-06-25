# Hundie

Weekly transaction classifier for multi-entity bookkeeping and taxes.

Hundie sorts every charge across businesses, rental properties, and personal life into the right **entity** and **tax category** — a little each week — so that at tax time your books are already clean, per-entity, and ready for the CPA.

**Status:** Initial setup — GitHub + Supabase connected.

## Stack

- **Database:** [Supabase](https://supabase.com) (Postgres)
- **GitHub:** `hundie-cursor` (ciutrust account)
- **App:** TBD (Next.js planned)

## Quick start

```bash
cd hundie-cursor
cp .env.local.example .env.local   # fill in Supabase keys from dashboard
npm install
npm run verify:db                  # confirm Supabase connection
```

## Supabase project

| Setting | Value |
|---------|-------|
| Project name | Hundie Project |
| Project ref | `ihciuqpiavxhbulfkwod` |
| Region | us-west-2 |
| Dashboard | https://supabase.com/dashboard/project/ihciuqpiavxhbulfkwod |

## Docs

- [Entity registry](docs/entities.md)
- [Supabase setup](docs/SUPABASE.md)

## MVP scope

1. Import card CSVs (Jan–Jun)
2. Monthly entity expense reports with drill-down
3. Reclassify transactions → reports update live
4. GBSL QuickBooks Online categories for training
