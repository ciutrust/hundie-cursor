#!/usr/bin/env node
/** Output { file, query } JSON for one ready SQL file (for MCP execute_sql). */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const name = process.argv[2];
if (!name) {
  console.error("Usage: node scripts/mcp-load-ready-sql.mjs <filename>");
  process.exit(1);
}

const path = resolve(__dirname, ".card-import-sql", name);
const query = readFileSync(path, "utf8");
process.stdout.write(JSON.stringify({ file: name, bytes: query.length, query }));
