import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlDir = join(__dirname, ".qb-import-sql");
const projectId = "ihciuqpiavxhbulfkwod";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Usage: node scripts/.exec-qb-sql-import.mjs <sql-file> [...]");
  process.exit(1);
}

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error("Set SUPABASE_ACCESS_TOKEN (Supabase OAuth token from Cursor MCP auth)");
  process.exit(1);
}

const transport = new StdioClientTransport({
  command: "npx",
  args: ["-y", "@supabase/mcp-server-supabase@latest", "--access-token", token],
});

const client = new Client({ name: "qb-import", version: "1.0.0" }, { capabilities: {} });
await client.connect(transport);

for (const file of files) {
  const path = join(sqlDir, file);
  const query = readFileSync(path, "utf8");
  process.stderr.write(`Executing ${file} (${query.length} bytes)...\n`);
  try {
    const result = await client.callTool({
      name: "execute_sql",
      arguments: { project_id: projectId, query },
    });
    const text = result.content?.map((c) => c.text).join("\n") ?? JSON.stringify(result);
    console.log(JSON.stringify({ file, ok: !result.isError, result: text.slice(0, 500) }));
    if (result.isError) process.exitCode = 1;
  } catch (err) {
    console.error(JSON.stringify({ file, ok: false, error: String(err) }));
    process.exitCode = 1;
  }
}

await client.close();
