#!/usr/bin/env node
/**
 * Read SQL files and execute via Supabase Management API (same backend as MCP execute_sql).
 * Usage: SUPABASE_ACCESS_TOKEN=... node scripts/.run-qb-mcp-exec-all.mjs
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlDir = join(__dirname, ".qb-import-sql");
const splitDir = join(sqlDir, ".mcp-split");
const projectId = "ihciuqpiavxhbulfkwod";
const token = process.env.SUPABASE_ACCESS_TOKEN;

if (!token) {
  console.error("Set SUPABASE_ACCESS_TOKEN");
  process.exit(1);
}

function orderedFiles() {
  const files = ["01-categories.sql"];
  for (let i = 1; i <= 13; i += 1) {
    const base = `04-expenses-json-${String(i).padStart(2, "0")}.sql`;
    const orig = join(sqlDir, base);
    if (!existsSync(orig)) continue;
    files.push(orig);
  }
  return files;
}

async function execSql(name, query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectId}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${name}: HTTP ${res.status} ${text.slice(0, 500)}`);
  }
  return text.slice(0, 500);
}

const results = [];
for (const rel of orderedFiles()) {
  const name = rel.split("/").pop();
  const query = readFileSync(rel, "utf8");
  process.stderr.write(`Executing ${name} (${query.length} bytes)...\n`);
  try {
    const result = await execSql(name, query);
    results.push({ file: name, ok: true, bytes: query.length, result });
    process.stderr.write(`OK ${name}\n`);
  } catch (err) {
    results.push({ file: name, ok: false, bytes: query.length, error: String(err.message ?? err) });
    process.stderr.write(`FAIL ${name}: ${err.message}\n`);
  }
}

const out = join(sqlDir, ".mcp-exec-results.json");
writeFileSync(out, JSON.stringify(results, null, 2));
console.log(JSON.stringify({ results, out }));

if (results.some((r) => !r.ok)) process.exit(1);
