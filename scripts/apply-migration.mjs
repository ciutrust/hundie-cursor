// Apply ONE migration file to the live DB, byte-exact and atomic.
//
// scripts/stage2/apply-migrations.mjs is a FROZEN historical batch (its FILES array stops at
// 20260708) — by design, so it can never re-run old migrations or sweep up new ones. Newer migrations
// normally go through the Supabase MCP apply_migration, but when the MCP is unavailable this is the
// fallback: same guarantee (one transaction, rollback on any error), one file at a time.
//
//   node scripts/apply-migration.mjs --file supabase/migrations/<name>.sql              # dry-run (ROLLBACK)
//   node scripts/apply-migration.mjs --file supabase/migrations/<name>.sql --apply      # COMMIT
//
// Needs a Postgres connection string (the DB password URI, NOT the service-role key):
//   DATABASE_URL=... node scripts/apply-migration.mjs --file ...   or --url "postgresql://..."
// (Falls back to DATABASE_URL in .env.local.)

import pg from "pg";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const args = process.argv.slice(2);

function argValue(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function loadEnvUrl() {
  const envPath = resolve(root, ".env.local");
  if (!existsSync(envPath)) return undefined;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === "DATABASE_URL") return trimmed.slice(eq + 1);
  }
  return undefined;
}

const apply = args.includes("--apply");
const file = argValue("--file");
const url = argValue("--url") ?? process.env.DATABASE_URL ?? loadEnvUrl();

if (!file) {
  console.error("Missing --file <path to .sql>");
  process.exit(1);
}
if (!url) {
  console.error("Missing a Postgres URL (--url, DATABASE_URL, or .env.local)");
  process.exit(1);
}

const path = resolve(root, file);
if (!existsSync(path)) {
  console.error(`No such migration: ${path}`);
  process.exit(1);
}
const sql = readFileSync(path, "utf8");

const client = new pg.Client({ connectionString: url });

try {
  await client.connect();
  await client.query("BEGIN");
  await client.query(sql);
  if (apply) {
    await client.query("COMMIT");
    console.log(`✓ APPLIED ${file}`);
  } else {
    await client.query("ROLLBACK");
    console.log(`✓ DRY RUN OK (rolled back) ${file}\n  re-run with --apply to commit`);
  }
} catch (error) {
  try {
    await client.query("ROLLBACK");
  } catch {
    // connection already dead — the transaction is gone either way
  }
  console.error(`✗ FAILED ${file}\n${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
