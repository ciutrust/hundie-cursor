#!/usr/bin/env node
/**
 * Split combined import SQL into statement-sized chunks for MCP execute_sql.
 * Writes to scripts/.card-import-sql/mcp-chunks/
 */
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlDir = resolve(__dirname, ".card-import-sql");
const outDir = resolve(sqlDir, "mcp-chunks");

mkdirSync(outDir, { recursive: true });

const combined = readdirSync(sqlDir)
  .filter((name) => name.endsWith("-combined.sql"))
  .sort();

let index = 0;
for (const file of combined) {
  const sql = readFileSync(resolve(sqlDir, file), "utf8");
  const parts = sql.split(/\n\n+/).filter(Boolean);

  for (const part of parts) {
    index += 1;
    const outPath = resolve(outDir, `${String(index).padStart(3, "0")}-${file.replace("-combined.sql", "")}.sql`);
    writeFileSync(outPath, part);
    console.log(`${outPath} (${part.length} bytes)`);
  }
}

console.log(`\n${index} chunks in ${outDir}`);
