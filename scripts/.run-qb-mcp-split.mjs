#!/usr/bin/env node
/** Split oversized 04-expenses-json-*.sql files so each half stays under MCP read limits. */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlDir = join(__dirname, ".qb-import-sql");
const outDir = join(sqlDir, ".mcp-split");
const MAX = 95_000;

function splitExpenseSql(name, sql) {
  if (sql.length <= MAX) return [{ name, sql }];

  const marker = "from jsonb_to_recordset('";
  const start = sql.indexOf(marker);
  if (start === -1) throw new Error(`${name}: missing jsonb_to_recordset marker`);
  const jsonStart = start + marker.length;
  const jsonEnd = sql.indexOf("'::jsonb)", jsonStart);
  if (jsonEnd === -1) throw new Error(`${name}: missing jsonb end marker`);

  const prefix = sql.slice(0, jsonStart);
  const suffix = sql.slice(jsonEnd);
  const records = JSON.parse(sql.slice(jsonStart, jsonEnd));
  const mid = Math.ceil(records.length / 2);
  const halves = [records.slice(0, mid), records.slice(mid)];

  return halves.map((chunk, i) => ({
    name: `${name}.part${i}`,
    sql: `${prefix}${JSON.stringify(chunk)}${suffix}`,
  }));
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Usage: node scripts/.run-qb-mcp-split.mjs <sql-file> [...]");
  process.exit(1);
}

for (const file of files) {
  const path = join(sqlDir, file);
  const sql = readFileSync(path, "utf8");
  const parts = splitExpenseSql(file, sql);
  for (const part of parts) {
    const out = join(outDir, part.name);
    writeFileSync(out, part.sql);
    console.log(JSON.stringify({ file: part.name, bytes: part.sql.length, out }));
  }
}
