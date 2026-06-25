#!/usr/bin/env node
/**
 * Execute all card import batches via Supabase Management API.
 * Requires SUPABASE_ACCESS_TOKEN in env (same OAuth token Cursor MCP uses).
 * Usage: SUPABASE_ACCESS_TOKEN=... node scripts/run-batches-api.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dir = resolve(__dirname, ".card-import-sql/mcp-batches");
const projectId = "ihciuqpiavxhbulfkwod";
const token = process.env.SUPABASE_ACCESS_TOKEN;

if (!token) {
  console.error("Missing SUPABASE_ACCESS_TOKEN");
  process.exit(1);
}

const results = [];
const only = process.argv.find((a) => a.startsWith("--batch="))?.split("=")[1];

async function execSql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectId}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const batches = only
  ? [only.padStart(2, "0")]
  : Array.from({ length: 10 }, (_, i) => String(i + 1).padStart(2, "0"));

for (const n of batches) {
  const callFile = resolve(dir, `.call-${n}.json`);
  const payload = JSON.parse(readFileSync(callFile, "utf8"));
  process.stderr.write(`Batch ${n}: ${payload.query.length} bytes...\n`);
  try {
    const data = await execSql(payload.query);
    results.push({ batch: n, ok: true, data });
    process.stderr.write(`Batch ${n}: OK\n`);
  } catch (err) {
    results.push({ batch: n, ok: false, error: String(err.message ?? err) });
    process.stderr.write(`Batch ${n}: FAIL ${err.message}\n`);
  }
}

const out = resolve(dir, "mcp-exec-results.json");
writeFileSync(out, JSON.stringify(results, null, 2));
console.log(JSON.stringify({ results, out }));
