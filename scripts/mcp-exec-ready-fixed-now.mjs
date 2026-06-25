#!/usr/bin/env node
/**
 * Execute .ready-00-fixed.sql: reads via fs.readFileSync, calls Supabase MCP execute_sql via SDK.
 * Loads SUPABASE_ACCESS_TOKEN from env or ~/.cursor (if available).
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = resolve(__dirname, ".card-import-sql/.ready-00-fixed.sql");
const projectId = "ihciuqpiavxhbulfkwod";
const query = readFileSync(sqlPath, "utf8");

function loadToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN;
  const envLocal = resolve(__dirname, "../.env.local");
  if (existsSync(envLocal)) {
    for (const line of readFileSync(envLocal, "utf8").split("\n")) {
      const m = line.match(/^SUPABASE_ACCESS_TOKEN=(.+)$/);
      if (m) return m[1].replace(/^["']|["']$/g, "");
    }
  }
  return null;
}

const token = loadToken();
if (!token) {
  console.log(JSON.stringify({ mode: "agent", project_id: projectId, bytes: query.length, file: ".ready-00-fixed.sql" }));
  process.exit(0);
}

const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");

const transport = new StdioClientTransport({
  command: "npx",
  args: ["-y", "@supabase/mcp-server-supabase@latest", "--access-token", token],
});
const client = new Client({ name: "exec-ready-fixed", version: "1.0.0" }, { capabilities: {} });

try {
  await client.connect(transport);
  const res = await client.callTool({
    name: "execute_sql",
    arguments: { project_id: projectId, query },
  });
  const text = res.content?.map((c) => c.text).join("") ?? "";
  console.log(JSON.stringify({ ok: !res.isError, bytes: query.length, result: text.slice(0, 500), error: res.isError ? text.slice(0, 2000) : undefined }));
  process.exit(res.isError ? 1 : 0);
} catch (err) {
  console.log(JSON.stringify({ ok: false, error: String(err.message ?? err).slice(0, 2000) }));
  process.exit(1);
} finally {
  await client.close();
}
