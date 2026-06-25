#!/usr/bin/env node
/**
 * Execute all 14 .ready SQL files via Supabase MCP execute_sql.
 * Agent driver: for each file index, stages SQL and prints instruction.
 * Agent must CallMcpTool(execute_sql) with query from staged file, then:
 *   node scripts/mcp-record-result.mjs <file> ok|fail [error]
 *
 * After all 14, run verification via MCP and:
 *   node scripts/mcp-finalize-results.mjs
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlDir = resolve(__dirname, ".card-import-sql");
const projectId = "ihciuqpiavxhbulfkwod";

export const FILES = [
  ".ready-00-part0.sql",
  ".ready-00-part1.sql",
  ...Array.from({ length: 12 }, (_, i) => `.ready-${String(i + 1).padStart(2, "0")}.sql`),
];

export const VERIFICATION_SQL = `select a.slug, count(t.id) as tx_count, min(t.transaction_date) as min_date, max(t.transaction_date) as max_date
from accounts a
left join transactions t on t.account_id = a.id
group by a.id, a.slug
order by a.slug;`;

const idx = Number(process.argv[2] ?? -1);
if (idx < 0 || idx >= FILES.length) {
  console.log(JSON.stringify({ files: FILES, total: FILES.length }));
  process.exit(0);
}

const file = FILES[idx];
const query = readFileSync(resolve(sqlDir, file), "utf8");
writeFileSync(resolve(sqlDir, ".next-mcp-exec.json"), JSON.stringify({ project_id: projectId, file, query, bytes: query.length }));
console.log(JSON.stringify({ index: idx, file, bytes: query.length, project_id: projectId, staged: ".next-mcp-exec.json" }));
