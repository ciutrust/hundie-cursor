#!/usr/bin/env node
/**
 * Agent driver: print MCP execute_sql args for one file (query via fs.readFileSync).
 * Usage: node scripts/mcp-emit-call.mjs .ready-02.sql
 * Output: single-line JSON { project_id, file, query, bytes }
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/mcp-emit-call.mjs <filename>");
  process.exit(1);
}
const query = readFileSync(resolve(__dirname, ".card-import-sql", file), "utf8");
process.stdout.write(
  JSON.stringify({ project_id: "ihciuqpiavxhbulfkwod", file, query, bytes: query.length }),
);
