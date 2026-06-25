#!/usr/bin/env node
/** Write .mcp-next-call.json with project_id + full query for index 0-13. */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlDir = resolve(__dirname, ".card-import-sql");
const projectId = "ihciuqpiavxhbulfkwod";

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
const query = sqlPath.endsWith(".json") ? JSON.parse(raw).query : raw;

const out = { project_id: projectId, file, query, bytes: query.length };
writeFileSync(resolve(sqlDir, ".mcp-next-call.json"), JSON.stringify(out));
writeFileSync(resolve(sqlDir, ".current-exec.sql"), query);
console.log(JSON.stringify({ index: idx, file, bytes: query.length }));
