#!/usr/bin/env node
/**
 * Execute card-import batch SQL files against Supabase Postgres.
 * Uses credentials from .env.local (DATABASE_URL or SUPABASE_DB_URL).
 * Does not print secrets.
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const dir = resolve(__dirname, ".card-import-sql/mcp-batches");
const resultsPath = resolve(dir, "batch-exec-results.json");

function loadEnv() {
  const envPath = resolve(root, ".env.local");
  if (!existsSync(envPath)) return {};
  const env = {};
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1).replace(/^['"]|['"]$/g, "");
  }
  return env;
}

function patchImportBatches(sql) {
  return sql.replace(
    /(insert into import_batches[\s\S]*?values\s*\([^)]+\))\s*;/gi,
    "$1 on conflict (id) do nothing;",
  );
}

const env = loadEnv();
const connectionString =
  env.DATABASE_URL ?? env.SUPABASE_DB_URL ?? env.POSTGRES_URL ?? env.DIRECT_URL;

if (!connectionString) {
  console.error(
    "Missing DATABASE_URL (or SUPABASE_DB_URL) in .env.local — add from Supabase Dashboard → Settings → Database",
  );
  process.exit(1);
}

const batchArg = process.argv[2];
const batches = batchArg
  ? [batchArg.padStart(2, "0")]
  : Array.from({ length: 10 }, (_, i) => String(i + 1).padStart(2, "0"));

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();

const results = [];

for (const n of batches) {
  const path = resolve(dir, `batch-${n}.sql`);
  const sql = patchImportBatches(readFileSync(path, "utf8"));
  const entry = { batch: n, bytes: sql.length, status: "pending", error: null };
  try {
    await client.query(sql);
    entry.status = "success";
  } catch (err) {
    entry.status = "failed";
    entry.error = err.message ?? String(err);
  }
  results.push(entry);
  console.log(JSON.stringify(entry));
}

await client.end();
writeFileSync(resultsPath, JSON.stringify(results, null, 2));

if (results.some((r) => r.status === "failed")) process.exit(1);
