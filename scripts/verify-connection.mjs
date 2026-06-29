import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const envPath = resolve(root, ".env.local");

function loadEnv() {
  if (!existsSync(envPath)) {
    console.error("Missing .env.local — copy from .env.local.example");
    process.exit(1);
  }

  const env = {};
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return env;
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  console.error(
    "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) in .env.local",
  );
  process.exit(1);
}

if (!env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    "Warning: SUPABASE_SERVICE_ROLE_KEY not set — using publishable key. After RLS lockdown, anon returns no rows.",
  );
}

const supabase = createClient(url, key);

const { data, error } = await supabase
  .from("entities")
  .select("name, slug, status, is_classifiable")
  .order("display_order");

if (error) {
  console.error("Supabase connection failed:", error.message);
  process.exit(1);
}

console.log(`Connected to ${url}`);
console.log(`Entities (${data.length}):`);
for (const row of data) {
  const tag = row.is_classifiable ? "classifiable" : row.status;
  console.log(`  - ${row.name} (${row.slug}) [${tag}]`);
}

// ─────────────────────────────────────────────────────────────────────────────
// SEC-03 — Verify the anon-RLS lockdown on the LIVE database (READ-ONLY).
//
// This cannot run from the client above: createClient() speaks PostgREST, which
// only exposes the `public` schema. pg_catalog (pg_policies / pg_class.relrowsecurity)
// is unreachable from PostgREST, and adding a direct pg connection would require
// DATABASE_URL credentials that are not part of this project's env contract
// (.env.local.example defines only NEXT_PUBLIC_SUPABASE_URL, *_PUBLISHABLE_KEY,
// and SUPABASE_SERVICE_ROLE_KEY). So this stays operator-run rather than folded
// into `npm run verify:db`. Run the following in Supabase Studio → SQL editor
// (or psql as the table owner / superuser):
//
//   -- 1. Every base table in `public` must have RLS enabled:
//   select c.relname as table, c.relrowsecurity as rls_enabled,
//          c.relforcerowsecurity as rls_forced
//   from pg_class c
//   join pg_namespace n on n.oid = c.relnamespace
//   where n.nspname = 'public' and c.relkind = 'r'
//   order by c.relname;
//   -- Expect rls_enabled = true for every row. Any false = anon-readable table.
//
//   -- 2. No policy may grant `anon` (or `public`) SELECT access:
//   select schemaname, tablename, policyname, roles, cmd, qual
//   from pg_policies
//   where schemaname = 'public'
//   order by tablename, policyname;
//   -- Expect: no row whose `roles` array contains `anon`/`public` with cmd = SELECT.
//
//   -- 3. RLS-enabled tables with zero policies = intended deny-all:
//   select c.relname
//   from pg_class c
//   join pg_namespace n on n.oid = c.relnamespace
//   left join pg_policies p
//     on p.schemaname = n.nspname and p.tablename = c.relname
//   where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
//   group by c.relname
//   having count(p.policyname) = 0;
// ─────────────────────────────────────────────────────────────────────────────
