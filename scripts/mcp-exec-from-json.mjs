#!/usr/bin/env node
/**
 * Read { project_id, query } from JSON path (argv[2]) and call Supabase MCP execute_sql via SDK.
 * Requires SUPABASE_ACCESS_TOKEN. Falls back to printing payload summary for agent CallMcpTool.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const jsonPath = resolve(process.argv[2] ?? "");
const token = process.env.SUPABASE_ACCESS_TOKEN;

if (!jsonPath) {
  console.error("Usage: node scripts/mcp-exec-from-json.mjs <payload.json>");
  process.exit(1);
}

const { project_id, query } = JSON.parse(readFileSync(jsonPath, "utf8"));

if (!token) {
  console.log(JSON.stringify({ mode: "agent", project_id, bytes: query.length }));
  process.exit(0);
}

const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");

const transport = new StdioClientTransport({
  command: "npx",
  args: ["-y", "@supabase/mcp-server-supabase@latest", "--access-token", token],
});
const client = new Client({ name: "mcp-exec-from-json", version: "1.0.0" }, { capabilities: {} });

try {
  await client.connect(transport);
  const res = await client.callTool({
    name: "execute_sql",
    arguments: { project_id, query },
  });
  const text = res.content?.map((c) => c.text).join("") ?? "";
  console.log(JSON.stringify({ ok: !res.isError, result: text.slice(0, 500), error: res.isError ? text.slice(0, 2000) : undefined }));
} catch (err) {
  console.log(JSON.stringify({ ok: false, error: String(err.message ?? err).slice(0, 2000) }));
} finally {
  await client.close();
}
