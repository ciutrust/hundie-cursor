# Supabase

## Project

- **Name:** Hundie Project
- **Ref:** `ihciuqpiavxhbulfkwod`
- **URL:** `https://ihciuqpiavxhbulfkwod.supabase.co`
- **Org:** ciutrust's Org
- **Region:** us-west-2

Dashboard: https://supabase.com/dashboard/project/ihciuqpiavxhbulfkwod

## Local environment

Copy `.env.local.example` to `.env.local` and set:

- `NEXT_PUBLIC_SUPABASE_URL` — project URL
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — publishable key (`sb_publishable_...`) from **Project Settings → API**

Never commit `.env.local` or the service role key.

## Cursor MCP

Supabase MCP is connected in this Cursor session. Tools available:

- `list_projects`, `execute_sql`, `apply_migration`, etc.

Project ID for MCP calls: `ihciuqpiavxhbulfkwod`

## Migrations

SQL migrations live in `supabase/migrations/`. Applied migrations are tracked in the Supabase dashboard under **Database → Migrations**.

### Applied

| Migration | Description |
|-----------|-------------|
| `create_entities` | Entity registry table + seed data (10 entities) |

## Verify connection

```bash
npm run verify:db
```

Expected output: lists 10 entities from the `entities` table.
