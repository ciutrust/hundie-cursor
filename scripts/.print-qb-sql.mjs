#!/usr/bin/env node
/** Print one SQL file contents to stdout for MCP execute_sql handoff. */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const name = process.argv[2];
if (!name) {
  console.error("Usage: node scripts/.print-qb-sql.mjs <filename>");
  process.exit(1);
}

const base = join("scripts", ".qb-import-sql");
const path = name.startsWith("04-")
  ? join(base, ".mcp-split", name)
  : join(base, name);

process.stdout.write(readFileSync(path, "utf8"));
