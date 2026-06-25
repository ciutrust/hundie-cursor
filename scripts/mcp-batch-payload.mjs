#!/usr/bin/env node
/**
 * Output MCP execute_sql payload JSON for a batch (01-10) to stdout.
 * Agent reads via: node scripts/mcp-batch-payload.mjs 01
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectId = "ihciuqpiavxhbulfkwod";
const n = (process.argv[2] ?? "").padStart(2, "0");

if (!/^\d{2}$/.test(n)) {
  console.error("Usage: node scripts/mcp-batch-payload.mjs <01-10>");
  process.exit(1);
}

const path = resolve(__dirname, `.card-import-sql/mcp-batches/batch-${n}.sql`);
let query = readFileSync(path, "utf8");
query = query.replace(
  /(insert into import_batches[\s\S]*?values\s*\([^)]+\))\s*;/gi,
  "$1 on conflict (id) do nothing;",
);

process.stdout.write(JSON.stringify({ project_id: projectId, batch: n, query }));
