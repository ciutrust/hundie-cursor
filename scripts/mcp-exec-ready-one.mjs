#!/usr/bin/env node
/** Print MCP execute_sql payload for one .ready-*.sql file (query loaded via fs.readFileSync). */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const name = process.argv[2];
if (!name) {
  console.error("Usage: node scripts/mcp-exec-ready-one.mjs <filename>");
  process.exit(1);
}

const query = readFileSync(resolve(__dirname, ".card-import-sql", name), "utf8");
process.stdout.write(JSON.stringify({ project_id: "ihciuqpiavxhbulfkwod", file: name, query }));
