#!/usr/bin/env node
/**
 * Execute mcp-batches via Supabase MCP execute_sql.
 * Reads batch-NN.sql files and prints results as JSON lines.
 * Invoked by agent with MCP tool per batch, or standalone if CURSOR_MCP available.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dir = resolve(__dirname, ".card-import-sql/mcp-batches");
const projectId = "ihciuqpiavxhbulfkwod";
const results = [];

for (let i = 1; i <= 10; i++) {
  const n = String(i).padStart(2, "0");
  const file = resolve(dir, `batch-${n}.sql`);
  if (!existsSync(file)) {
    results.push({ batch: n, ok: false, error: `missing ${file}` });
    continue;
  }
  const query = readFileSync(file, "utf8");
  writeFileSync(resolve(dir, `.last-batch-${n}.sql`), query);
  results.push({ batch: n, bytes: query.length, file });
}

writeFileSync(resolve(dir, "batch-manifest.json"), JSON.stringify({ projectId, results }, null, 2));
console.log(JSON.stringify({ projectId, results }, null, 2));
