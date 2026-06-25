#!/usr/bin/env node
/**
 * Agent helper: for each .ready SQL file, write {file, project_id, queryPath, bytes}
 * and save query to .card-import-sql/.agent-query/{file}.sql for MCP handoff.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlDir = resolve(__dirname, ".card-import-sql");
const agentDir = resolve(sqlDir, ".agent-query");
mkdirSync(agentDir, { recursive: true });

const FILES = [
  ".ready-00-part0.sql",
  ".ready-00-part1.sql",
  ...Array.from({ length: 12 }, (_, i) => `.ready-${String(i + 1).padStart(2, "0")}.sql`),
];

const manifest = FILES.map((file) => {
  const src = resolve(sqlDir, file);
  const query = readFileSync(src, "utf8");
  const out = resolve(agentDir, file);
  writeFileSync(out, query);
  return { file, project_id: "ihciuqpiavxhbulfkwod", queryPath: out, bytes: query.length };
});

writeFileSync(resolve(sqlDir, ".agent-manifest.json"), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest.map(({ file, bytes }) => ({ file, bytes }))));
