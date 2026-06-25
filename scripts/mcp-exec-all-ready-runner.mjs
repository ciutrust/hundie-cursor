#!/usr/bin/env node
/**
 * Execute all .ready-* SQL files via Supabase MCP execute_sql using SDK.
 * Requires SUPABASE_ACCESS_TOKEN in environment.
 * Outputs JSON: { results, verification, summary }
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlDir = resolve(__dirname, ".card-import-sql");
const projectId = "ihciuqpiavxhbulfkwod";
const token = process.env.SUPABASE_ACCESS_TOKEN;

const FILES = [
  ".ready-00-part0.sql",
  ".ready-00-part1.sql",
  ...Array.from({ length: 12 }, (_, i) => `.ready-${String(i + 1).padStart(2, "0")}.sql`),
];

const VERIFICATION_SQL = `select a.slug, count(t.id) as tx_count, min(t.transaction_date) as min_date, max(t.transaction_date) as max_date
from accounts a
left join transactions t on t.account_id = a.id
group by a.id, a.slug
order by a.slug;`;

async function main() {
  if (!token) {
    console.error(JSON.stringify({ error: "SUPABASE_ACCESS_TOKEN not set" }));
    process.exit(1);
  }

  const transport = new StdioClientTransport({
    command: "npx",
    args: ["-y", "@supabase/mcp-server-supabase@latest", "--access-token", token],
  });

  const client = new Client({ name: "mcp-exec-all-ready-runner", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);

  const results = [];

  for (const file of FILES) {
    const query = readFileSync(resolve(sqlDir, file), "utf8");
    process.stderr.write(`${file}: ${query.length} bytes\n`);
    try {
      const res = await client.callTool({
        name: "execute_sql",
        arguments: { project_id: projectId, query },
      });
      const text = res.content?.map((c) => c.text).join("") ?? "";
      const isError = res.isError === true;
      const entry = { file, ok: !isError };
      if (isError) entry.error = text.slice(0, 2000);
      results.push(entry);
      process.stderr.write(`${file}: ${isError ? "FAIL" : "OK"}\n`);
    } catch (err) {
      results.push({ file, ok: false, error: String(err.message ?? err).slice(0, 2000) });
      process.stderr.write(`${file}: FAIL ${err.message}\n`);
    }
  }

  let verification = [];
  try {
    const res = await client.callTool({
      name: "execute_sql",
      arguments: { project_id: projectId, query: VERIFICATION_SQL },
    });
    const text = res.content?.map((c) => c.text).join("") ?? "";
    const match = text.match(/\[[\s\S]*\]/);
    verification = match ? JSON.parse(match[0]) : text;
  } catch (err) {
    verification = { error: String(err.message ?? err) };
  }

  await client.close();

  const summary = {
    ok: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    total: results.length,
  };

  const output = { results, verification, summary };
  writeFileSync(resolve(sqlDir, ".ready-import-results.json"), JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output));
}

main().catch((err) => {
  console.error(JSON.stringify({ error: String(err.message ?? err) }));
  process.exit(1);
});
