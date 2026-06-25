#!/usr/bin/env node
/**
 * Build final .ready-import-results.json from execution log.
 * Usage: node mcp-build-results.mjs < results-log.json
 * Or pass results inline via --from-partial
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlDir = resolve(__dirname, ".card-import-sql");

const verificationPath = resolve(sqlDir, ".verification.json");
const verification = existsSync(verificationPath)
  ? JSON.parse(readFileSync(verificationPath, "utf8"))
  : [];

let results = [];
if (process.argv[2] === "--from-partial") {
  const partialPath = resolve(sqlDir, ".ready-import-results.partial.json");
  results = existsSync(partialPath)
    ? JSON.parse(readFileSync(partialPath, "utf8")).results ?? []
    : [];
} else {
  const input = readFileSync(0, "utf8").trim();
  if (input) results = JSON.parse(input);
}

const summary = {
  ok: results.filter((r) => r.ok).length,
  failed: results.filter((r) => !r.ok).length,
  total: results.length,
};

const output = { results, verification, summary };
writeFileSync(resolve(sqlDir, ".ready-import-results.json"), JSON.stringify(output, null, 2));
console.log(JSON.stringify(output));
