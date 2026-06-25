#!/usr/bin/env node
/**
 * Execute card import batch SQL files using Supabase service role from .env.local.
 * Fallback when MCP batch payloads are too large for agent tool calls.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const dir = resolve(__dirname, ".card-import-sql/mcp-batches");

function loadEnv() {
  const envPath = resolve(root, ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
    }
  }
}

function patchImportBatches(sql) {
  return sql.replace(
    /(insert into import_batches[\s\S]*?values\s*\([^)]+\))\s*;/gi,
    "$1 on conflict (id) do nothing;",
  );
}

loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

const batchArg = process.argv[2];
const batches = batchArg
  ? [batchArg.padStart(2, "0")]
  : Array.from({ length: 10 }, (_, i) => String(i + 1).padStart(2, "0"));

const results = [];

for (const n of batches) {
  const path = resolve(dir, `batch-${n}.sql`);
  const sql = patchImportBatches(readFileSync(path, "utf8"));
  const entry = { batch: n, status: "pending", error: null, bytes: sql.length };
  try {
    const { error } = await supabase.rpc("exec_sql", { query: sql });
    if (error) {
      // rpc may not exist — use postgres via fetch to /rest/v1/rpc or raw SQL endpoint
      throw error;
    }
    entry.status = "success";
  } catch (err) {
    entry.status = "failed";
    entry.error = err.message ?? String(err);
  }
  results.push(entry);
  console.log(JSON.stringify(entry));
}

if (results.some((r) => r.status === "failed")) process.exit(1);
