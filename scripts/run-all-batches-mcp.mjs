#!/usr/bin/env node
/**
 * Execute all card import batch SQL files via Supabase MCP execute_sql.
 * Uses @modelcontextprotocol/sdk stdio client + SUPABASE_ACCESS_TOKEN.
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=sbp_... node scripts/run-all-batches-mcp.mjs
 *   SUPABASE_ACCESS_TOKEN=sbp_... node scripts/run-all-batches-mcp.mjs --batch 08
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dir = resolve(__dirname, ".card-import-sql/mcp-batches");
const projectId = "ihciuqpiavxhbulfkwod";
const token = process.env.SUPABASE_ACCESS_TOKEN;
const resultsPath = resolve(dir, "batch-exec-results.json");

if (!token) {
  console.error("Missing SUPABASE_ACCESS_TOKEN (Supabase personal access token)");
  process.exit(1);
}

function patchImportBatches(sql) {
  return sql.replace(
    /(insert into import_batches[\s\S]*?values\s*\([^)]+\))\s*;/gi,
    "$1 on conflict (id) do nothing;",
  );
}

function loadBatch(n) {
  const sql = patchImportBatches(readFileSync(resolve(dir, `batch-${n}.sql`), "utf8"));
  return { batch: n, project_id: projectId, query: sql, bytes: sql.length };
}

const only = process.argv.find((a) => a.startsWith("--batch="))?.split("=")[1]
  ?? (process.argv.includes("--batch") ? process.argv[process.argv.indexOf("--batch") + 1] : null);

const batches = only
  ? [only.padStart(2, "0")]
  : Array.from({ length: 10 }, (_, i) => String(i + 1).padStart(2, "0"));

const transport = new StdioClientTransport({
  command: "npx",
  args: ["-y", "@supabase/mcp-server-supabase@latest", "--access-token", token],
  env: { ...process.env, SUPABASE_ACCESS_TOKEN: token },
});

const client = new Client({ name: "run-all-batches-mcp", version: "1.0.0" }, { capabilities: {} });

const results = existsSync(resultsPath) ? JSON.parse(readFileSync(resultsPath, "utf8")) : [];

try {
  await client.connect(transport);

  for (const n of batches) {
    const payload = loadBatch(n);
    process.stderr.write(`Batch ${n}: ${payload.bytes} bytes...\n`);
    const entry = { batch: n, bytes: payload.bytes, status: "pending", error: null };
    try {
      const res = await client.callTool({
        name: "execute_sql",
        arguments: { project_id: projectId, query: payload.query },
      });
      const text = res.content?.map((c) => (c.type === "text" ? c.text : "")).join("") ?? "";
      if (res.isError) {
        entry.status = "failed";
        entry.error = text.slice(0, 1000);
        process.stderr.write(`Batch ${n}: FAIL ${entry.error}\n`);
      } else {
        entry.status = "success";
        entry.result = text.slice(0, 200);
        process.stderr.write(`Batch ${n}: OK\n`);
      }
    } catch (err) {
      entry.status = "failed";
      entry.error = String(err.message ?? err);
      process.stderr.write(`Batch ${n}: FAIL ${entry.error}\n`);
    }
    const idx = results.findIndex((r) => r.batch === n);
    if (idx >= 0) results[idx] = entry;
    else results.push(entry);
    results.sort((a, b) => a.batch.localeCompare(b.batch));
    writeFileSync(resultsPath, JSON.stringify(results, null, 2));
  }
} finally {
  await client.close().catch(() => {});
}

console.log(JSON.stringify({ results, resultsPath }));
