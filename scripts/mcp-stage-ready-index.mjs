#!/usr/bin/env node
/** Stage one ready import SQL to .current-exec.sql for MCP execute_sql. */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlDir = resolve(__dirname, ".card-import-sql");

const FILES = [
  ".ready-00-part0.sql",
  ".ready-00-part1.sql",
  ...Array.from({ length: 12 }, (_, i) => `.ready-${String(i + 1).padStart(2, "0")}.sql`),
];

const idx = Number(process.argv[2]);
const file = FILES[idx];
const payloadPath = resolve(sqlDir, `.payload-${file}.json`);
const sqlPath = existsSync(payloadPath) ? payloadPath : resolve(sqlDir, file);
const raw = readFileSync(sqlPath, "utf8");
const sql = sqlPath.endsWith(".json") ? JSON.parse(raw).query : raw;
writeFileSync(resolve(sqlDir, ".current-exec.sql"), sql);
console.log(JSON.stringify({ index: idx, file, bytes: sql.length }));
