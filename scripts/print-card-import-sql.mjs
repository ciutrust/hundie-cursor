#!/usr/bin/env node
/** Print combined import SQL files for Supabase MCP execute_sql (one file per arg, or all). */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlDir = resolve(__dirname, ".card-import-sql");

const slugs = process.argv.slice(2);

let files = readdirSync(sqlDir)
  .filter((name) => name.endsWith("-combined.sql"))
  .sort();

if (slugs.length > 0) {
  files = files.filter((name) => slugs.some((slug) => name.includes(slug)));
}

if (files.length === 0) {
  console.error("No combined SQL files. Run: node scripts/generate-card-import-sql.mjs");
  process.exit(1);
}

for (const file of files) {
  const path = resolve(sqlDir, file);
  if (!existsSync(path)) continue;
  process.stdout.write(`\n===== ${file} =====\n`);
  process.stdout.write(readFileSync(path, "utf8"));
}
