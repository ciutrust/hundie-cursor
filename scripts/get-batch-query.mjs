#!/usr/bin/env node
/** Output patched batch SQL to stdout for MCP execute_sql. */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const n = (process.argv[2] ?? "").padStart(2, "0");
if (!/^\d{2}$/.test(n)) {
  console.error("Usage: node scripts/get-batch-query.mjs <01-10>");
  process.exit(1);
}

const path = resolve(__dirname, `.card-import-sql/mcp-batches/batch-${n}.sql`);
let sql = readFileSync(path, "utf8");
sql = sql.replace(
  /(insert into import_batches[\s\S]*?values\s*\([^)]+\))\s*;/gi,
  "$1 on conflict (id) do nothing;",
);
process.stdout.write(sql);
