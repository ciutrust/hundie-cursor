#!/usr/bin/env node
/**
 * Reads batch SQL from mcp-batches and outputs one JSON line per batch for MCP execute_sql.
 * Agent reads output and calls CallMcpTool per batch.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dir = resolve(__dirname, ".card-import-sql/mcp-batches");
const projectId = "ihciuqpiavxhbulfkwod";

const batch = process.argv[2]?.padStart(2, "0");
if (!batch || !/^\d{2}$/.test(batch)) {
  console.error("Usage: node scripts/mcp-exec-batch-runner.mjs <01-10>");
  process.exit(1);
}

const patched = resolve(dir, `.exec-batch-${batch}.sql`);
const orig = resolve(dir, `batch-${batch}.sql`);
const sqlPath = existsSync(patched) ? patched : orig;
const query = readFileSync(sqlPath, "utf8");

process.stdout.write(
  JSON.stringify({ project_id: projectId, batch, bytes: query.length, query }),
);
