// Stage 2 Phase 3: apply the 29 unapplied migrations to the live DB, byte-exact and atomic.
//
// Reads the exact .sql files (no transcription) and runs them in ONE transaction.
//   --dry-run : BEGIN → apply all 29 → ROLLBACK   (proves they succeed; changes nothing)
//   --apply   : BEGIN → apply all 29 → COMMIT
// Any error rolls the whole batch back and reports the offending file. Re-runnable
// (every migration is verified idempotent in docs/STAGE2-MIGRATION-AUDIT.md).
//
// Needs a Postgres connection string (DB password — NOT the service-role key):
//   Supabase Dashboard → Project Settings → Database → Connection string (URI).
// Provide via:  DATABASE_URL=... npm exec ...   or   --url "postgresql://..."
// (Falls back to DATABASE_URL in .env.local if present.)

import pg from "pg";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..", "..");
const migDir = join(root, "supabase", "migrations");

// The verified 29-file apply set (files #16–#44), in filename order. Explicit list so we
// can never accidentally re-run the 15 already-tracked migrations or pick up future files.
const FILES = [
  "20260701140000_keller_refund_category.sql",
  "20260702120000_create_bank_connections.sql",
  "20260702130000_create_plaid_account_links.sql",
  "20260702140000_hide_split_mortgage_categories.sql",
  "20260702150000_personal_legal_professional_category.sql",
  "20260702160000_income_funding_capital_categories.sql",
  "20260702170000_cash_back_category.sql",
  "20260703120000_add_transactions_external_id.sql",
  "20260703140000_add_transactions_plaid_removed_at.sql",
  "20260703141000_bank_connections_sync_from_date_not_null.sql",
  "20260704120000_mortgage_interest_principal_split.sql",
  "20260704121000_gbsl_vehicle_loan_split.sql",
  "20260704122000_gbsl_rent_expense_locations.sql",
  "20260704123000_intercompany_136_anita.sql",
  "20260704124000_meals_entertainment_split.sql",
  "20260704125000_chart_tidy.sql",
  "20260704190000_categories_kind_column.sql",
  "20260705120000_tax_line_form_mapping.sql",
  "20260705121000_entities_return_type.sql",
  "20260705122000_transaction_splits.sql",
  "20260705123000_self_rental_links.sql",
  "20260705124000_tx_franchise_margin_tax.sql",
  "20260705125000_personal_tax_categories.sql",
  "20260705126000_personal_charitable_sch_a.sql",
  "20260706120000_create_payees.sql",
  "20260706121000_create_fixed_assets.sql",
  "20260706122000_create_account_reconciliations.sql",
  "20260706123000_create_sales_tax_periods.sql",
  // C8 (Batch F): audit-only transaction_history table + trigger. Idempotent (create ... if not
  // exists / create or replace / drop ... if exists), so re-running the batch is safe.
  // NOTE: the three 20260707*_*.sql proposals migrations are intentionally NOT in this list — that is
  // an operator decision to make separately, not part of this batch.
  "20260708120000_transaction_history.sql",
];

function loadDotEnv() {
  const p = join(root, ".env.local");
  if (!existsSync(p)) return {};
  const env = {};
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq !== -1) {
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      env[t.slice(0, eq)] = v;
    }
  }
  return env;
}

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const dryRun = argv.includes("--dry-run") || !apply;
const urlArg = (() => { const i = argv.indexOf("--url"); return i !== -1 ? argv[i + 1] : null; })();
const conn = urlArg || process.env.DATABASE_URL || loadDotEnv().DATABASE_URL;

if (!conn) {
  console.error("No connection string. Set DATABASE_URL (or pass --url \"postgresql://...\").");
  console.error("Get it: Supabase Dashboard → Project Settings → Database → Connection string (URI).");
  process.exit(2);
}

// Verify all files exist before connecting.
for (const f of FILES) {
  if (!existsSync(join(migDir, f))) { console.error(`Missing migration file: ${f}`); process.exit(2); }
}

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });

console.log(`Stage-2 Phase-3 apply — ${FILES.length} files — mode: ${apply ? "APPLY (COMMIT)" : "DRY RUN (ROLLBACK)"}`);
await client.connect();
let failed = null;
try {
  await client.query("BEGIN");
  let i = 0;
  for (const f of FILES) {
    i++;
    const sql = readFileSync(join(migDir, f), "utf8");
    process.stdout.write(`  [${String(i).padStart(2)}/${FILES.length}] ${f.padEnd(52)} `);
    await client.query(sql);
    console.log("ok");
  }
  if (apply) {
    await client.query("COMMIT");
    console.log(`\n✅ COMMITTED — all ${FILES.length} migrations applied.`);
  } else {
    await client.query("ROLLBACK");
    console.log(`\n✅ DRY RUN OK — all ${FILES.length} applied cleanly inside a transaction, then ROLLED BACK (no changes). Re-run with --apply to commit.`);
  }
} catch (e) {
  failed = e;
  try { await client.query("ROLLBACK"); } catch {}
  console.log("FAILED");
  console.error(`\n❌ Error (whole batch rolled back): ${e.message}`);
  if (e.position) console.error(`   at character position ${e.position}`);
} finally {
  await client.end();
}
process.exit(failed ? 1 : 0);
