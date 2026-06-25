#!/usr/bin/env node
/** Print raw SQL for batch NN (patched) — used to feed MCP execute_sql. */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const n = (process.argv[2] ?? "").padStart(2, "0");
const path = resolve(__dirname, `.card-import-sql/mcp-batches/.run-query-${n}.sql`);
process.stdout.write(readFileSync(path, "utf8"));
