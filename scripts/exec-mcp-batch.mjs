#!/usr/bin/env node
/**
 * Execute all mcp-batches by reading SQL files.
 * Outputs batch execution manifest; agent calls CallMcpTool per batch.
 * Usage: node scripts/exec-mcp-batch.mjs 01
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectId = "ihciuqpiavxhbulfkwod";
const batch = process.argv[2];

if (!batch || !/^\d{1,2}$/.test(batch)) {
  console.error("Usage: node scripts/exec-mcp-batch.mjs <batch-number>");
  process.exit(1);
}

const n = batch.padStart(2, "0");
const sqlPath = resolve(__dirname, `.card-import-sql/mcp-batches/batch-${n}.sql`);

if (!existsSync(sqlPath)) {
  console.error(`Missing ${sqlPath}`);
  process.exit(1);
}

const query = readFileSync(sqlPath, "utf8");
process.stdout.write(JSON.stringify({ project_id: projectId, batch: n, query }));
