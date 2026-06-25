#!/usr/bin/env node
/**
 * Execute one .ready SQL file via Supabase MCP execute_sql (stdio SDK).
 * Reads SQL with fs.readFileSync. Appends result to .ready-import-results.partial.json
 *
 * Usage: SUPABASE_ACCESS_TOKEN=... node scripts/mcp-exec-one-ready.mjs .ready-02.sql
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlDir = resolve(__dirname, ".card-import-sql");
const projectId = "ihciuqpiavxhbulfkwod";
const file = process.argv[2];
const token = process.env.SUPABASE_ACCESS_TOKEN;

if (!file || !token) {
  console.error(JSON.stringify({ error: "Usage: SUPABASE_ACCESS_TOKEN=... node mcp-exec-one-ready.mjs <file>" }));
  process.exit(1);
}

const query = readFileSync(resolve(sqlDir, file), "utf8");
const partialPath = resolve(sqlDir, ".ready-import-results.partial.json");
const partial = existsSync(partialPath) ? JSON.parse(readFileSync(partialPath, "utf8")) : { results: [] };

const transport = new StdioClientTransport({
  command: "npx",
  args: ["-y", "@supabase/mcp-server-supabase@latest", "--access-token", token],
});
const client = new Client({ name: "mcp-exec-one", version: "1.0.0" }, { capabilities: {} });

try {
  await client.connect(transport);
  const res = await client.callTool({
    name: "execute_sql",
    arguments: { project_id: projectId, query },
  });
  const text = res.content?.map((c) => c.text).join("") ?? "";
  const entry = { file, ok: !res.isError };
  if (res.isError) entry.error = text.slice(0, 2000);
  partial.results.push(entry);
  writeFileSync(partialPath, JSON.stringify(partial, null, 2));
  console.log(JSON.stringify(entry));
} catch (err) {
  const entry = { file, ok: false, error: String(err.message ?? err).slice(0, 2000) };
  partial.results.push(entry);
  writeFileSync(partialPath, JSON.stringify(partial, null, 2));
  console.log(JSON.stringify(entry));
} finally {
  await client.close();
}
