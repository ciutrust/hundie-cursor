#!/usr/bin/env node
/**
 * Execute all card-import batch SQL files via Supabase MCP execute_sql.
 * Reads batch-01.sql through batch-10.sql (with ON CONFLICT patch for import_batches).
 * Requires Cursor MCP Supabase server to be available.
 *
 * Usage: node scripts/run-all-mcp-batches.mjs
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dir = resolve(__dirname, ".card-import-sql/mcp-batches");
const projectId = "ihciuqpiavxhbulfkwod";
const resultsPath = resolve(dir, "batch-results.json");

function patchImportBatches(sql) {
  return sql.replace(
    /(insert into import_batches[\s\S]*?values\s*\([^)]+\))\s*;/gi,
    "$1 on conflict (id) do nothing;",
  );
}

function readBatchSql(n) {
  const orig = resolve(dir, `batch-${n}.sql`);
  const raw = readFileSync(orig, "utf8");
  return patchImportBatches(raw);
}

const results = [];

for (let i = 1; i <= 10; i++) {
  const n = String(i).padStart(2, "0");
  const query = readBatchSql(n);
  const entry = { batch: n, bytes: query.length, status: "pending", error: null };
  results.push(entry);
  console.log(`Prepared batch-${n}: ${query.length} bytes`);
}

writeFileSync(resultsPath, JSON.stringify(results, null, 2));
console.log(`\nWrote ${resultsPath}`);
console.log("Execute each batch via MCP execute_sql with project_id:", projectId);
