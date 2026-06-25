#!/usr/bin/env node
/** Merge mcp-chunks into batches (~80KB) for fewer execute_sql calls. */
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const chunkDir = resolve(__dirname, ".card-import-sql/mcp-chunks");
const outDir = resolve(__dirname, ".card-import-sql/mcp-batches");
const maxBytes = 80000;

mkdirSync(outDir, { recursive: true });

const chunks = readdirSync(chunkDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

let batch = [];
let batchSize = 0;
let batchNum = 0;

function flush() {
  if (batch.length === 0) return;
  batchNum += 1;
  const path = resolve(outDir, `batch-${String(batchNum).padStart(2, "0")}.sql`);
  writeFileSync(path, batch.join("\n\n"));
  console.log(`${path}: ${batch.length} chunks, ${batchSize} bytes`);
  batch = [];
  batchSize = 0;
}

for (const file of chunks) {
  const sql = readFileSync(resolve(chunkDir, file), "utf8");
  if (batchSize + sql.length > maxBytes && batch.length > 0) flush();
  batch.push(sql);
  batchSize += sql.length;
}

flush();
console.log(`\n${batchNum} batches in ${outDir}`);
