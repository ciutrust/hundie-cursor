#!/usr/bin/env node
/** Finalize .ready-import-results.json from partial results + verification JSON file. */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlDir = resolve(__dirname, ".card-import-sql");
const partialPath = resolve(sqlDir, ".ready-import-results.partial.json");
const verificationPath = resolve(sqlDir, ".verification.json");

const partial = existsSync(partialPath) ? JSON.parse(readFileSync(partialPath, "utf8")) : { results: [] };
const verification = existsSync(verificationPath) ? JSON.parse(readFileSync(verificationPath, "utf8")) : [];

const results = partial.results ?? [];
const summary = {
  ok: results.filter((r) => r.ok).length,
  failed: results.filter((r) => !r.ok).length,
  total: results.length,
};

const output = { results, verification, summary };
writeFileSync(resolve(sqlDir, ".ready-import-results.json"), JSON.stringify(output, null, 2));
console.log(JSON.stringify(output));
