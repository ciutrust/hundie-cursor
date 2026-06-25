import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlDir = resolve(__dirname, ".card-import-sql");

const files = readdirSync(sqlDir)
  .filter((name) => name.endsWith("-combined.sql"))
  .sort();

if (files.length === 0) {
  console.error("No combined SQL files found. Run generate-card-import-sql.mjs first.");
  process.exit(1);
}

for (const file of files) {
  const sql = readFileSync(resolve(sqlDir, file), "utf8");
  process.stdout.write(`\n---FILE:${file}---\n`);
  process.stdout.write(sql);
}
