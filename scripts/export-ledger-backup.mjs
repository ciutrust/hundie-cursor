// Stage-2 Phase-1 backup: full logical export of the live ledger via the service-role client.
//
// Writes one JSON file per table (all rows, all columns) plus a manifest.json with
// row counts + an integrity check (fetched length must equal the authoritative count).
// This is a RESTORABLE backup of the data at risk before the Phase-4 truncate.
//
// Output goes OUTSIDE the repo by default (financial data must never be committed):
//   ~/hundie-backups/stage2-<UTC timestamp>/
// Override with:  node scripts/export-ledger-backup.mjs --out /some/dir
//
// READ-ONLY against the DB. Safe to run repeatedly.

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const envPath = resolve(root, ".env.local");

function loadEnv() {
  if (!existsSync(envPath)) {
    console.error("Missing .env.local — copy from .env.local.example");
    process.exit(1);
  }
  const env = {};
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    env[t.slice(0, eq)] = t.slice(eq + 1);
  }
  return env;
}

// Tables to back up. The 7 wipe=true tables are the ones Phase 4 truncates;
// KEEP tables are exported too so the backup is a complete logical snapshot.
const TABLES = [
  { name: "transactions", wipe: true },
  { name: "classifications", wipe: true },
  { name: "classification_history", wipe: true },
  { name: "raw_import_rows", wipe: true },
  { name: "import_batches", wipe: true },
  { name: "ai_suggestions", wipe: true },
  { name: "suggestion_events", wipe: true },
  // KEEP tables (never wiped) — exported for completeness / total-restore fidelity:
  { name: "entities", wipe: false },
  { name: "categories", wipe: false },
  { name: "accounts", wipe: false },
  { name: "bank_connections", wipe: false },
  { name: "plaid_account_links", wipe: false },
  { name: "qb_training_expenses", wipe: false },
];

const PAGE = 1000;

function argOut() {
  const i = process.argv.indexOf("--out");
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  return join(homedir(), "hundie-backups", `stage2-${stamp}`);
}

async function fetchAll(supabase, table) {
  // authoritative count
  const { count, error: cErr } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true });
  if (cErr) throw new Error(`count(${table}): ${cErr.message}`);

  const rows = [];
  for (let from = 0; from < (count ?? 0); from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`select(${table}) range ${from}: ${error.message}`);
    rows.push(...data);
  }
  return { count: count ?? 0, rows };
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local (service-role required to bypass RLS).");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

const outDir = argOut();
mkdirSync(outDir, { recursive: true });
console.log(`Backup → ${outDir}\nDB: ${url}\n`);

const manifest = {
  created_at: new Date().toISOString(),
  db_url: url,
  out_dir: outDir,
  tables: {},
};
let ok = true;

for (const { name, wipe } of TABLES) {
  process.stdout.write(`  ${name.padEnd(24)} `);
  try {
    const { count, rows } = await fetchAll(supabase, name);
    const integrity = rows.length === count;
    if (!integrity) ok = false;
    writeFileSync(join(outDir, `${name}.json`), JSON.stringify(rows));
    manifest.tables[name] = { count, exported: rows.length, integrity_ok: integrity, wipe };
    console.log(`${String(count).padStart(6)} rows  ${integrity ? "OK" : "!! MISMATCH"}  ${wipe ? "(wipe)" : "(keep)"}`);
  } catch (e) {
    ok = false;
    manifest.tables[name] = { error: String(e.message ?? e), wipe };
    console.log(`ERROR: ${e.message ?? e}`);
  }
}

writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
const wipeTotal = Object.entries(manifest.tables)
  .filter(([, v]) => v.wipe && v.exported != null)
  .reduce((s, [, v]) => s + v.exported, 0);
console.log(`\nmanifest.json written. Wipe-table rows backed up: ${wipeTotal}`);
console.log(ok ? "\n✅ Backup complete — all integrity checks passed." : "\n❌ Backup had errors/mismatches — DO NOT proceed to any wipe.");
process.exit(ok ? 0 : 1);
