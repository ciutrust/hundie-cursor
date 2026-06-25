#!/usr/bin/env node
/**
 * Execute all card-import batch SQL files via Supabase MCP execute_sql.
 * Reads each batch file and invokes MCP through Cursor's MCP bridge if available,
 * otherwise writes per-batch status for agent follow-up.
 *
 * Usage: node scripts/mcp-run-all-batches.mjs [--batch 01]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dir = resolve(__dirname, ".card-import-sql/mcp-batches");
const projectId = "ihciuqpiavxhbulfkwod";
const resultsFile = resolve(dir, "batch-exec-results.json");

function patchImportBatches(sql) {
  return sql.replace(
    /(insert into import_batches[\s\S]*?values\s*\([^)]+\))\s*;/gi,
    "$1 on conflict (id) do nothing;",
  );
}

function readBatch(n) {
  const orig = resolve(dir, `batch-${n}.sql`);
  return patchImportBatches(readFileSync(orig, "utf8"));
}

const batchArg = process.argv.find((a) => a.startsWith("--batch="))?.split("=")[1]
  ?? (process.argv.includes("--batch") ? process.argv[process.argv.indexOf("--batch") + 1] : null);

const batches = batchArg ? [batchArg.padStart(2, "0")] : Array.from({ length: 10 }, (_, i) => String(i + 1).padStart(2, "0"));

const results = existsSync(resultsFile)
  ? JSON.parse(readFileSync(resultsFile, "utf8"))
  : [];

for (const n of batches) {
  const query = readBatch(n);
  const outFile = resolve(dir, `.mcp-exec-payload-${n}.json`);
  writeFileSync(outFile, JSON.stringify({ project_id: projectId, query }));
  console.log(JSON.stringify({ batch: n, bytes: query.length, payload: outFile, status: "ready" }));
}
