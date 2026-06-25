#!/usr/bin/env node
/** Print {project_id, file, query} for one ready import index (0-13). */
import { readFileSync, existsSync } from "node:fs";
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
if (Number.isNaN(idx) || idx < 0 || idx >= FILES.length) {
  console.error(`Usage: mcp-exec-ready-index.mjs <0-${FILES.length - 1}>`);
  process.exit(1);
}

const file = FILES[idx];
const payloadPath = resolve(sqlDir, `.payload-${file}.json`);
const sqlPath = existsSync(payloadPath) ? payloadPath : resolve(sqlDir, file);
const raw = readFileSync(sqlPath, "utf8");
const sql = sqlPath.endsWith(".json") ? JSON.parse(raw).query : raw;

process.stdout.write(
  JSON.stringify({ project_id: projectId, file, query: sql, bytes: sql.length }),
);
