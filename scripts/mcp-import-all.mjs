#!/usr/bin/env node
/**
 * Execute all combined card import SQL files via Supabase MCP execute_sql.
 * Run from repo root: node scripts/mcp-import-all.mjs
 *
 * Prints JSON lines { file, ok, error? } for each file — pipe to a coordinator
 * or use with Cursor agent CallMcpTool(execute_sql).
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlDir = resolve(__dirname, ".card-import-sql");

const files = readdirSync(sqlDir)
  .filter((name) => name.endsWith("-combined.sql"))
  .sort();

if (process.argv.includes("--list")) {
  for (const file of files) {
    const sql = readFileSync(resolve(sqlDir, file), "utf8");
    console.log(`${file}\t${sql.length}`);
  }
  process.exit(0);
}

const index = Number.parseInt(process.argv[2] ?? "0", 10);
if (!files[index]) {
  console.error(`Usage: node scripts/mcp-import-all.mjs <0-${files.length - 1}> | --list`);
  process.exit(1);
}

const file = files[index];
const query = readFileSync(resolve(sqlDir, file), "utf8");
process.stdout.write(JSON.stringify({ file, index, query }));
