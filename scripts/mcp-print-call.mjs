#!/usr/bin/env node
/**
 * Execute one batch via Supabase MCP execute_sql by reading .call-NN.json
 * and printing MCP tool invocation payload to stdout (for agent handoff).
 * The agent should CallMcpTool with the printed JSON.
 *
 * Usage: node scripts/mcp-print-call.mjs 08
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const n = (process.argv[2] ?? "").padStart(2, "0");
const payload = JSON.parse(
  readFileSync(resolve(__dirname, `.card-import-sql/mcp-batches/.call-${n}.json`), "utf8"),
);
process.stdout.write(JSON.stringify(payload));
