#!/usr/bin/env node
/**
 * Execute one .ready SQL file: reads query via fs.readFileSync, calls Supabase MCP execute_sql.
 * Uses @modelcontextprotocol/sdk + stdio transport when SUPABASE_ACCESS_TOKEN is set.
 * Otherwise writes {file, query, project_id} to .card-import-sql/.next-mcp-exec.json for agent.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlDir = resolve(__dirname, ".card-import-sql");
const projectId = "ihciuqpiavxhbulfkwod";
const file = process.argv[2];
const token = process.env.SUPABASE_ACCESS_TOKEN;

if (!file) {
  console.error("Usage: node scripts/mcp-run-one-ready.mjs <filename>");
  process.exit(1);
}

const query = readFileSync(resolve(sqlDir, file), "utf8");

if (!token) {
  const payload = { project_id: projectId, file, query, bytes: query.length };
  writeFileSync(resolve(sqlDir, ".next-mcp-exec.json"), JSON.stringify(payload));
  console.log(JSON.stringify({ mode: "agent", file, bytes: query.length }));
  process.exit(0);
}

const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");

const transport = new StdioClientTransport({
  command: "npx",
  args: ["-y", "@supabase/mcp-server-supabase@latest", "--access-token", token],
});
const client = new Client({ name: "mcp-run-one", version: "1.0.0" }, { capabilities: {} });

try {
  await client.connect(transport);
  const res = await client.callTool({
    name: "execute_sql",
    arguments: { project_id: projectId, query },
  });
  const text = res.content?.map((c) => c.text).join("") ?? "";
  const out = { file, ok: !res.isError };
  if (res.isError) out.error = text.slice(0, 2000);
  console.log(JSON.stringify(out));
} catch (err) {
  console.log(JSON.stringify({ file, ok: false, error: String(err.message ?? err).slice(0, 2000) }));
} finally {
  await client.close();
}
