#!/usr/bin/env node
/**
 * Execute all 14 .ready SQL files via direct Postgres (service role / DATABASE_URL).
 * Reads SQL via fs.readFileSync. Outputs JSON { results, verification, summary }.
 *
 * Usage:
 *   node scripts/mcp-exec-all-ready-via-pg.mjs
 *
 * Requires DATABASE_URL or SUPABASE_DB_URL in .env.local or environment.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlDir = resolve(__dirname, ".card-import-sql");
const envPath = resolve(__dirname, "..", ".env.local");

function loadEnv() {
  if (process.env.DATABASE_URL || process.env.SUPABASE_DB_URL) return;
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

loadEnv();
const conn = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
if (!conn) {
  console.error(JSON.stringify({ error: "Set DATABASE_URL or SUPABASE_DB_URL" }));
  process.exit(1);
}

const FILES = [
  ".ready-00-part0.sql",
  ".ready-00-part1.sql",
  ...Array.from({ length: 12 }, (_, i) => `.ready-${String(i + 1).padStart(2, "0")}.sql`),
];

const VERIFICATION_SQL = `select a.slug, count(t.id) as tx_count, min(t.transaction_date) as min_date, max(t.transaction_date) as max_date
from accounts a
left join transactions t on t.account_id = a.id
group by a.id, a.slug
order by a.slug;`;

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
await client.connect();

const results = [];
for (const file of FILES) {
  const query = readFileSync(resolve(sqlDir, file), "utf8");
  process.stderr.write(`${file}: ${query.length} bytes\n`);
  try {
    await client.query(query);
    results.push({ file, ok: true });
    process.stderr.write(`${file}: OK\n`);
  } catch (err) {
    results.push({ file, ok: false, error: String(err.message ?? err).slice(0, 2000) });
    process.stderr.write(`${file}: FAIL ${err.message}\n`);
  }
}

let verification = [];
try {
  const res = await client.query(VERIFICATION_SQL);
  verification = res.rows;
} catch (err) {
  verification = { error: String(err.message ?? err) };
}

await client.end();

const summary = {
  ok: results.filter((r) => r.ok).length,
  failed: results.filter((r) => !r.ok).length,
  total: results.length,
};

const output = { results, verification, summary };
writeFileSync(resolve(sqlDir, ".ready-import-results.json"), JSON.stringify(output, null, 2));
console.log(JSON.stringify(output));
