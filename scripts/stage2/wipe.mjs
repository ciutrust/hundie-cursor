// Stage 2 Phase 4: the reset. Truncate the 7 transactional tables, atomically.
//
//   --dry-run : BEGIN → null import_batch_id → TRUNCATE → null sync_cursor → verify → ROLLBACK
//   --apply   : same, but COMMIT (only if every post-check passes; else ROLLBACK + abort)
//
// CASCADE trap: TRUNCATE ... CASCADE cascades by FK CONSTRAINT existence (not by whether rows
// reference it), so it would empty qb_training_expenses (the only KEEP table with an FK into the
// wipe set) regardless. So we DELETE in FK-dependency order instead, after nulling that FK so the
// NO ACTION constraint on import_batches isn't violated. PKs are UUIDs → no identity to restart.
// The script asserts qb_training_expenses + the other KEEP tables are UNCHANGED before committing.
//
// Reversible from the Phase-1 backup until Phase 7 passes. Needs DATABASE_URL (.env.local).

import pg from "pg";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
function loadDotEnv() {
  const p = join(root, ".env.local");
  if (!existsSync(p)) return {};
  const env = {};
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[t.slice(0, eq)] = v;
  }
  return env;
}

const WIPE = [
  "transactions",
  "classifications",
  "classification_history",
  "ai_suggestions",
  "suggestion_events",
  "raw_import_rows",
  "import_batches",
];
const KEEP = ["entities", "categories", "accounts", "bank_connections", "plaid_account_links", "qb_training_expenses"];

const apply = process.argv.includes("--apply");
const conn = process.env.DATABASE_URL || loadDotEnv().DATABASE_URL;
if (!conn) { console.error("DATABASE_URL not set (.env.local)."); process.exit(2); }

async function countAll(client, tables) {
  const out = {};
  for (const t of tables) {
    const { rows } = await client.query(`select count(*)::int n from ${t}`);
    out[t] = rows[0].n;
  }
  return out;
}

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log(`Stage-2 Phase-4 wipe — mode: ${apply ? "APPLY (COMMIT)" : "DRY RUN (ROLLBACK)"}\n`);

let failed = null;
try {
  // ---- BEFORE ----
  const beforeWipe = await countAll(client, WIPE);
  const beforeKeep = await countAll(client, KEEP);
  const snapBefore = (await client.query("select count(*)::int n from qb_training_expenses where transaction_type='hundie_snapshot'")).rows[0].n;
  const cursorsBefore = (await client.query("select count(*)::int n from bank_connections where sync_cursor is not null")).rows[0].n;
  console.log("BEFORE — wipe tables:", JSON.stringify(beforeWipe));
  console.log("BEFORE — keep tables:", JSON.stringify(beforeKeep), `| snapshot=${snapBefore} | connections w/ cursor=${cursorsBefore}\n`);

  await client.query("BEGIN");

  // 1) Null the only external FK into the wipe set so DELETE FROM import_batches isn't restricted
  //    by qb_training_expenses' NO ACTION constraint.
  const nulled = await client.query("update qb_training_expenses set import_batch_id = null where import_batch_id is not null");
  console.log(`  nulled qb_training_expenses.import_batch_id on ${nulled.rowCount} rows`);

  // 2) The reset — DELETE in FK-dependency order (children first). NOT truncate-cascade (which would
  //    empty qb_training_expenses via its FK constraint). This permutation of WIPE respects every
  //    intra-set FK: history → events/suggestions → classifications → raw/transactions → batches.
  const DELETE_ORDER = [
    "classification_history",
    "suggestion_events",
    "ai_suggestions",
    "classifications",
    "raw_import_rows",
    "transactions",
    "import_batches",
  ];
  for (const t of DELETE_ORDER) {
    const r = await client.query(`delete from ${t}`);
    console.log(`  deleted ${r.rowCount} from ${t}`);
  }

  // 3) Null Plaid cursors so the post-wipe "Sync now" re-pulls history (filtered by sync_from_date).
  const cur = await client.query("update bank_connections set sync_cursor = null, updated_at = now() where sync_cursor is not null");
  console.log(`  nulled bank_connections.sync_cursor on ${cur.rowCount} rows\n`);

  // ---- AFTER (inside txn) ----
  const afterWipe = await countAll(client, WIPE);
  const afterKeep = await countAll(client, KEEP);
  const snapAfter = (await client.query("select count(*)::int n from qb_training_expenses where transaction_type='hundie_snapshot'")).rows[0].n;
  const cursorsAfter = (await client.query("select count(*)::int n from bank_connections where sync_cursor is not null")).rows[0].n;
  console.log("AFTER  — wipe tables:", JSON.stringify(afterWipe));
  console.log("AFTER  — keep tables:", JSON.stringify(afterKeep), `| snapshot=${snapAfter} | connections w/ cursor=${cursorsAfter}\n`);

  // ---- ASSERTIONS (abort if any fail) ----
  const checks = [];
  for (const t of WIPE) checks.push([`${t} empty`, afterWipe[t] === 0]);
  for (const t of KEEP) checks.push([`${t} unchanged (${beforeKeep[t]})`, afterKeep[t] === beforeKeep[t]]);
  checks.push([`snapshot intact (${snapBefore})`, snapAfter === snapBefore]);
  checks.push(["all sync_cursor null", cursorsAfter === 0]);

  let allOk = true;
  for (const [label, ok] of checks) { console.log(`  ${ok ? "✓" : "✗"} ${label}`); if (!ok) allOk = false; }

  if (!allOk) {
    await client.query("ROLLBACK");
    throw new Error("Post-checks FAILED — rolled back, nothing changed.");
  }

  if (apply) {
    await client.query("COMMIT");
    console.log("\n✅ COMMITTED — transactional tables reset; KEEP data + snapshot intact; cursors nulled.");
  } else {
    await client.query("ROLLBACK");
    console.log("\n✅ DRY RUN OK — full wipe executed cleanly in a transaction, then ROLLED BACK (no changes). Re-run with --apply to commit.");
  }
} catch (e) {
  failed = e;
  try { await client.query("ROLLBACK"); } catch {}
  console.error(`\n❌ ${e.message}`);
} finally {
  await client.end();
}
process.exit(failed ? 1 : 0);
