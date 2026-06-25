#!/usr/bin/env node
/**
 * Execute all 14 .ready SQL files via Supabase MCP execute_sql using Cursor plugin.
 * Reads each SQL file with fs.readFileSync, calls execute_sql, writes results JSON.
 *
 * This script uses dynamic import of a thin wrapper that invokes MCP through
 * the Supabase Management API when SUPABASE_ACCESS_TOKEN is set, otherwise
 * prints payloads for agent CallMcpTool execution.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
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

const VERIFICATION_SQL = `select a.slug, count(t.id) as tx_count, min(t.transaction_date) as min_date, max(t.transaction_date) as max_date
from accounts a
left join transactions t on t.account_id = a.id
group by a.id, a.slug
order by a.slug;`;

function loadEnvLocal() {
  const envPath = resolve(__dirname, "..", ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

loadEnvLocal();

async function execViaApi(query) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error("SUPABASE_ACCESS_TOKEN not set");
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectId}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
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
    const msg = typeof body === "object" ? body.message || body.error || JSON.stringify(body) : String(body);
    throw new Error(msg);
  }
  return body;
}

async function main() {
  const mode = process.env.SUPABASE_ACCESS_TOKEN ? "api" : "emit";
  const results = [];

  for (const file of FILES) {
    const query = readFileSync(resolve(sqlDir, file), "utf8");
    process.stderr.write(`${file}: ${query.length} bytes\n`);
    if (mode === "emit") {
      results.push({ file, ok: null, pending: true, bytes: query.length });
      continue;
    }
    try {
      await execViaApi(query);
      results.push({ file, ok: true });
      process.stderr.write(`${file}: OK\n`);
    } catch (err) {
      results.push({ file, ok: false, error: String(err.message ?? err).slice(0, 2000) });
      process.stderr.write(`${file}: FAIL ${err.message}\n`);
    }
  }

  let verification = [];
  if (mode === "api") {
    try {
      verification = await execViaApi(VERIFICATION_SQL);
    } catch (err) {
      verification = { error: String(err.message ?? err) };
    }
  }

  const summary = {
    ok: results.filter((r) => r.ok === true).length,
    failed: results.filter((r) => r.ok === false).length,
    pending: results.filter((r) => r.pending).length,
    total: results.length,
  };

  const output = { mode, results, verification, summary };
  writeFileSync(resolve(sqlDir, ".ready-import-results.json"), JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output));
}

main().catch((err) => {
  console.error(JSON.stringify({ error: String(err.message ?? err) }));
  process.exit(1);
});
