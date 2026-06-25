#!/usr/bin/env node
/**
 * Execute batches 01-10 via Supabase MCP execute_sql using @modelcontextprotocol/sdk.
 * Requires Cursor's Supabase MCP OAuth token in SUPABASE_ACCESS_TOKEN.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dir = resolve(__dirname, ".card-import-sql/mcp-batches");
const projectId = "ihciuqpiavxhbulfkwod";
const token = process.env.SUPABASE_ACCESS_TOKEN;

if (!token) {
  console.error("Set SUPABASE_ACCESS_TOKEN (Supabase OAuth token from Cursor MCP auth)");
  process.exit(1);
}

const transport = new StdioClientTransport({
  command: "npx",
  args: ["-y", "@supabase/mcp-server-supabase@latest", "--access-token", token],
});

const client = new Client({ name: "mcp-exec-loop", version: "1.0.0" }, { capabilities: {} });
await client.connect(transport);

const only = process.argv.find((a) => a.startsWith("--batch="))?.split("=")[1];
const batches = only
  ? [only.padStart(2, "0")]
  : Array.from({ length: 10 }, (_, i) => String(i + 1).padStart(2, "0"));

const results = [];

for (const n of batches) {
  const payload = JSON.parse(readFileSync(resolve(dir, `.call-${n}.json`), "utf8"));
  process.stderr.write(`Batch ${n}: ${payload.query.length} bytes...\n`);
  try {
    const res = await client.callTool({
      name: "execute_sql",
      arguments: { project_id: projectId, query: payload.query },
    });
    const text = res.content?.map((c) => c.text).join("") ?? "";
    results.push({ batch: n, ok: true, result: text.slice(0, 500) });
    process.stderr.write(`Batch ${n}: OK\n`);
  } catch (err) {
    results.push({ batch: n, ok: false, error: String(err.message ?? err) });
    process.stderr.write(`Batch ${n}: FAIL ${err.message}\n`);
  }
}

await client.close();
const out = resolve(dir, "mcp-exec-results.json");
writeFileSync(out, JSON.stringify(results, null, 2));
console.log(JSON.stringify({ results, out }));
