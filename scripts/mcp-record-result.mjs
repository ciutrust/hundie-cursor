#!/usr/bin/env node
/** Append execution result to .ready-import-results.partial.json */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const partialPath = resolve(__dirname, ".card-import-sql", ".ready-import-results.partial.json");
const file = process.argv[2];
const ok = process.argv[3] === "ok";
const error = process.argv[4];

const partial = existsSync(partialPath) ? JSON.parse(readFileSync(partialPath, "utf8")) : { results: [] };
const entry = { file, ok };
if (!ok && error) entry.error = error;
partial.results.push(entry);
writeFileSync(partialPath, JSON.stringify(partial, null, 2));
console.log(JSON.stringify(entry));
