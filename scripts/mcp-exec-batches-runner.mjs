#!/usr/bin/env node
/**
 * Execute all card import batches via Supabase MCP execute_sql.
 * Reads batch-01.sql through batch-10.sql (with import_batches ON CONFLICT patch).
 * Outputs one JSON result line per batch to stdout; writes batch-exec-results.json.
 *
 * This script is meant to be driven by an agent calling MCP execute_sql per batch.
 * Usage: node scripts/mcp-exec-batches-runner.mjs --emit 08
 *        node scripts/mcp-exec-batches-runner.mjs --record 08 success
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dir = resolve(__dirname, ".card-import-sql/mcp-batches");
const projectId = "ihciuqpiavxhbulfkwod";
const resultsPath = resolve(dir, "batch-exec-results.json");

function patchImportBatches(sql) {
  return sql.replace(
    /(insert into import_batches[\s\S]*?values\s*\([^)]+\))\s*;/gi,
    "$1 on conflict (id) do nothing;",
  );
}

function loadBatch(n) {
  const sql = patchImportBatches(readFileSync(resolve(dir, `batch-${n}.sql`), "utf8"));
  return { batch: n, project_id: projectId, query: sql, bytes: sql.length };
}

function loadResults() {
  if (!existsSync(resultsPath)) return [];
  return JSON.parse(readFileSync(resultsPath, "utf8"));
}

function saveResults(results) {
  writeFileSync(resultsPath, JSON.stringify(results, null, 2));
}

const emitArg = process.argv.indexOf("--emit");
const recordArg = process.argv.indexOf("--record");

if (emitArg !== -1) {
  const n = process.argv[emitArg + 1]?.padStart(2, "0");
  if (!n) {
    console.error("Usage: node scripts/mcp-exec-batches-runner.mjs --emit 01");
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(loadBatch(n)));
  process.exit(0);
}

if (recordArg !== -1) {
  const n = process.argv[recordArg + 1]?.padStart(2, "0");
  const status = process.argv[recordArg + 2] ?? "success";
  const error = process.argv[recordArg + 3] ?? null;
  const results = loadResults().filter((r) => r.batch !== n);
  results.push({ batch: n, status, error });
  results.sort((a, b) => a.batch.localeCompare(b.batch));
  saveResults(results);
  console.log(JSON.stringify({ batch: n, status, error, resultsPath }));
  process.exit(0);
}

// default: list batches
const list = Array.from({ length: 10 }, (_, i) => {
  const n = String(i + 1).padStart(2, "0");
  const { bytes } = loadBatch(n);
  return { batch: n, bytes };
});
console.log(JSON.stringify(list, null, 2));
