#!/usr/bin/env node
/**
 * Helper: reads batch SQL files and prints JSON lines for MCP execute_sql.
 * Usage: node scripts/run-mcp-batches.mjs --batch 01
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dir = resolve(__dirname, ".card-import-sql/mcp-batches");
const projectId = "ihciuqpiavxhbulfkwod";

const batchArg = process.argv.find((a) => a.startsWith("--batch="));
const batch = batchArg?.split("=")[1] ?? process.argv[process.argv.indexOf("--batch") + 1];
if (!batch) {
  console.error("Usage: node scripts/run-mcp-batches.mjs --batch 01");
  process.exit(1);
}

const file = resolve(dir, `batch-${batch.padStart(2, "0")}.sql`);
const query = readFileSync(file, "utf8");
process.stdout.write(JSON.stringify({ project_id: projectId, query, batch: batch.padStart(2, "0") }));
