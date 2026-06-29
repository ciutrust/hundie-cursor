import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, ".card-import-sql");

const files = readdirSync(outDir)
  .filter((name) => name.endsWith(".sql") && !name.includes("-combined"))
  .sort();

const accounts = new Map();

for (const file of files) {
  const match = file.match(/^(\d+)-(.+?)-(batch|transactions|classifications)\.sql$/);
  if (!match) continue;

  const [, index, slug, kind] = match;
  const key = `${index}-${slug}`;
  if (!accounts.has(key)) {
    accounts.set(key, { index, slug, parts: {} });
  }
  accounts.get(key).parts[kind] = readFileSync(resolve(outDir, file), "utf8");
}

for (const { index, slug, parts } of [...accounts.values()].sort((a, b) => a.index.localeCompare(b.index))) {
  const combined = [parts.batch, parts.transactions, parts.classifications].filter(Boolean).join("\n\n");
  const outPath = resolve(outDir, `${index}-${slug}-combined.sql`);
  writeFileSync(outPath, combined);
  console.log(`${slug}: ${combined.length} bytes`);
}
