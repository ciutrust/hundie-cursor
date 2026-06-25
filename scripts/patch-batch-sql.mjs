#!/usr/bin/env node
/**
 * Prepare batch SQL for idempotent MCP execution.
 * Adds ON CONFLICT (id) DO NOTHING to import_batches inserts.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dir = resolve(__dirname, ".card-import-sql/mcp-batches");

function patchImportBatches(sql) {
  return sql.replace(
    /(insert into import_batches[\s\S]*?values\s*\([^)]+\))\s*;/gi,
    "$1 on conflict (id) do nothing;",
  );
}

const batch = process.argv[2];
if (!batch) {
  console.error("Usage: node scripts/patch-batch-sql.mjs <batch-number>");
  process.exit(1);
}

const n = batch.padStart(2, "0");
const src = resolve(dir, `batch-${n}.sql`);
if (!existsSync(src)) {
  console.error(`Missing ${src}`);
  process.exit(1);
}

const raw = readFileSync(src, "utf8");
const patched = patchImportBatches(raw);
const out = resolve(dir, `.exec-batch-${n}.sql`);
writeFileSync(out, patched);
process.stdout.write(
  JSON.stringify({
    project_id: "ihciuqpiavxhbulfkwod",
    batch: n,
    bytes: patched.length,
    out,
    query: patched,
  }),
);
