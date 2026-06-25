#!/usr/bin/env node
/**
 * Execute generated card import SQL files in order.
 * Used when SUPABASE_SERVICE_ROLE_KEY is not set — run output via Supabase MCP execute_sql,
 * or pipe each file: node scripts/execute-card-import-sql.mjs | ...
 *
 * Default: prints each SQL file path and statement count for manual/MCP execution.
 * With --print-sql: prints full SQL separated by markers.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlDir = resolve(__dirname, ".card-import-sql");
const printSql = process.argv.includes("--print-sql");

if (!existsSync(sqlDir)) {
  console.error("Missing scripts/.card-import-sql — run: node scripts/generate-card-import-sql.mjs");
  process.exit(1);
}

const files = readdirSync(sqlDir)
  .filter((name) => /^\d{2}-.+\-(batch|transactions|classifications)\.sql$/.test(name))
  .sort();

if (files.length === 0) {
  console.error("No SQL files found");
  process.exit(1);
}

for (const file of files) {
  const sql = readFileSync(resolve(sqlDir, file), "utf8");
  const statements = sql.split(/\n\n+/).filter(Boolean);

  if (printSql) {
    process.stdout.write(`\n--- ${file} (${statements.length} statements) ---\n`);
    process.stdout.write(`${sql}\n`);
  } else {
    console.log(`${file}: ${statements.length} statement(s), ${sql.length} bytes`);
  }
}

if (!printSql) {
  console.log(`\n${files.length} files ready. Execute via Supabase MCP execute_sql or add SUPABASE_SERVICE_ROLE_KEY and run npm run import:cards`);
}
