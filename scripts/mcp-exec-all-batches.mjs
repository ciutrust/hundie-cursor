#!/usr/bin/env node
/**
 * Read batch SQL (patched invoke JSON or batch-NN.sql) and print one JSON line per batch
 * for MCP execute_sql: { batch, project_id, query, bytes }
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dir = resolve(__dirname, ".card-import-sql/mcp-batches");
const projectId = "ihciuqpiavxhbulfkwod";

function patchImportBatches(sql) {
  return sql.replace(
    /(insert into import_batches[\s\S]*?values\s*\([^)]+\))\s*;/gi,
    "$1 on conflict (id) do nothing;",
  );
}

function loadBatch(n) {
  const batchFile = resolve(dir, `batch-${n}.sql`);
  const invokeFile = resolve(dir, `.invoke-${n}.json`);
  if (existsSync(invokeFile)) {
    const inv = JSON.parse(readFileSync(invokeFile, "utf8"));
    return { batch: n, project_id: projectId, query: inv.query, bytes: inv.query.length, source: invokeFile };
  }
  let query = readFileSync(batchFile, "utf8");
  query = patchImportBatches(query);
  return { batch: n, project_id: projectId, query, bytes: query.length, source: batchFile };
}

const only = process.argv.find((a) => a.startsWith("--batch="))?.split("=")[1];
const batches = only ? [only.padStart(2, "0")] : Array.from({ length: 10 }, (_, i) => String(i + 1).padStart(2, "0"));

for (const n of batches) {
  const payload = loadBatch(n);
  process.stdout.write(JSON.stringify(payload) + "\n");
}
