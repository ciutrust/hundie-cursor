#!/usr/bin/env node
/**
 * Execute one .ready SQL file via Supabase Management API.
 * Usage: SUPABASE_ACCESS_TOKEN=... node scripts/mcp-http-exec-one.mjs .ready-02.sql
 */
import { readFileSync, appendFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectId = "ihciuqpiavxhbulfkwod";
const file = process.argv[2];
const token = process.env.SUPABASE_ACCESS_TOKEN;

if (!file || !token) {
  console.error("Usage: SUPABASE_ACCESS_TOKEN=... node scripts/mcp-http-exec-one.mjs <filename>");
  process.exit(1);
}

const query = readFileSync(resolve(__dirname, ".card-import-sql", file), "utf8");
const res = await fetch(`https://api.supabase.com/v1/projects/${projectId}/database/query`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ query }),
});

const body = await res.text();
let ok = res.ok;
let error;
try {
  const j = JSON.parse(body);
  if (j.error || j.message?.includes("ERROR")) {
    ok = false;
    error = j.error || j.message || body;
  }
} catch {
  if (!ok) error = body;
}

const entry = { file, ok, ...(error ? { error: String(error).slice(0, 2000) } : {}) };
const outPath = resolve(__dirname, ".card-import-sql/.ready-import-results-partial.jsonl");
appendFileSync(outPath, JSON.stringify(entry) + "\n");
console.log(JSON.stringify(entry));
