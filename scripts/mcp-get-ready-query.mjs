#!/usr/bin/env node
/** Print raw SQL from .card-import-sql/.ready-* file to stdout (fs.readFileSync). */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const name = process.argv[2];
if (!name) {
  console.error("Usage: node scripts/mcp-get-ready-query.mjs <filename>");
  process.exit(1);
}
process.stdout.write(readFileSync(resolve(__dirname, ".card-import-sql", name), "utf8"));
