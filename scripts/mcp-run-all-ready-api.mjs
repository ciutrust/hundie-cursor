#!/usr/bin/env node
/**
 * Execute all 14 ready imports via Supabase Management API (needs SUPABASE_ACCESS_TOKEN).
 * Fallback when agent cannot inline large SQL into CallMcpTool.
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlDir = resolve(__dirname, ".card-import-sql");
const projectId = "ihciuqpiavxhbulfkwod";

const FILES = [
  ".ready-00-part0.sql",
  ".ready-00-part1.sql",
  ...Array.from({ length: 12 }, (_, i) => `.ready-${String(i + 1).padStart(2, "0")}.sql`),
];

function loadEnvLocal() {
  const envPath = resolve(__dirname, "..", ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

loadEnvLocal();

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error("SUPABASE_ACCESS_TOKEN not set");
  process.exit(2);
}

async function execSql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectId}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) {
    const err = typeof body === "object" ? body.message || body.error || JSON.stringify(body) : String(body);
    throw new Error(err);
  }
  return body;
}

const VERIFICATION_SQL = `select a.slug, count(t.id) as tx_count, min(t.transaction_date) as min_date, max(t.transaction_date) as max_date
from accounts a
left join transactions t on t.account_id = a.id
group by a.id, a.slug
order by a.slug;`;

const results = [];
for (let i = 0; i < FILES.length; i++) {
  const file = FILES[i];
  const payloadPath = resolve(sqlDir, `.payload-${file}.json`);
  const raw = readFileSync(payloadPath, "utf8");
  const query = JSON.parse(raw).query;
  process.stderr.write(`[${i + 1}/14] ${file} (${query.length} bytes)...\n`);
  try {
    await execSql(query);
    results.push({ file, ok: true });
    process.stderr.write(`  OK\n`);
  } catch (e) {
    results.push({ file, ok: false, error: String(e.message || e) });
    process.stderr.write(`  FAIL: ${e.message}\n`);
  }
}

let verification = [];
try {
  verification = await execSql(VERIFICATION_SQL);
} catch (e) {
  verification = { error: String(e.message || e) };
}

const summary = {
  ok: results.filter((r) => r.ok).length,
  failed: results.filter((r) => !r.ok).length,
  total: results.length,
};

const output = { results, verification, summary };
writeFileSync(resolve(sqlDir, ".ready-import-results.json"), JSON.stringify(output, null, 2));
writeFileSync(resolve(sqlDir, ".verification.json"), JSON.stringify(verification, null, 2));
console.log(JSON.stringify(output));
