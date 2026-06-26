#!/usr/bin/env node
/**
 * C5 guard: find ledger transactions that have NO classification row.
 *
 * The review/report queries inner-join classifications, so a transaction without
 * one is invisible to every total AND to the review backlog — a silently-missing
 * expense. Import normally creates a classification per transaction, but the two
 * inserts are not atomic, so a partial failure can orphan a row.
 *
 * This script reports orphans (always) and, with --apply, heals each by inserting
 * a default classification (entity = the account's default entity, category = null,
 * classified_by = 'import-heal') so it reappears in the review backlog for a human
 * to categorize. It NEVER overwrites an existing classification.
 *
 * Usage:
 *   node scripts/audit-orphan-classifications.mjs            # report only
 *   node scripts/audit-orphan-classifications.mjs --apply    # heal
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "..", ".env.local");

function loadEnv() {
  if (!existsSync(envPath)) {
    console.error("Missing .env.local");
    process.exit(1);
  }
  const env = {};
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return env;
}

const apply = process.argv.includes("--apply");
const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(url, serviceKey);

const PAGE = 1000;

async function fetchOrphans() {
  const orphans = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("transactions")
      .select(
        `id, account_id, transaction_date, amount, description,
         account:accounts!inner(default_entity_id),
         classification:classifications(id)`,
      )
      .order("transaction_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    for (const row of page) {
      const hasClassification = Array.isArray(row.classification)
        ? row.classification.length > 0
        : row.classification != null;
      if (!hasClassification) orphans.push(row);
    }
    if (page.length < PAGE) break;
    from += PAGE;
  }
  return orphans;
}

const orphans = await fetchOrphans();

console.log(`Orphan transactions (no classification row): ${orphans.length}`);
for (const row of orphans.slice(0, 20)) {
  console.log(
    `  ${row.transaction_date}  ${String(row.amount).padStart(10)}  ${row.description.slice(0, 50)}`,
  );
}
if (orphans.length > 20) console.log(`  …and ${orphans.length - 20} more`);

if (orphans.length === 0) {
  console.log("No orphans — every transaction has a classification.");
  process.exit(0);
}

if (!apply) {
  console.log("\nDry run. Re-run with --apply to insert default classifications (backlog).");
  process.exit(0);
}

const withEntity = orphans.filter((row) => row.account?.default_entity_id);
const missingEntity = orphans.length - withEntity.length;
if (missingEntity > 0) {
  console.warn(`  ${missingEntity} orphan(s) have an account with no default entity — skipped.`);
}

let healed = 0;
for (let i = 0; i < withEntity.length; i += 200) {
  const batch = withEntity.slice(i, i + 200).map((row) => ({
    transaction_id: row.id,
    entity_id: row.account.default_entity_id,
    category_id: null,
    classified_by: "import-heal",
  }));
  const { error } = await supabase
    .from("classifications")
    .upsert(batch, { onConflict: "transaction_id", ignoreDuplicates: true });
  if (error) throw new Error(`Heal insert failed: ${error.message}`);
  healed += batch.length;
}

console.log(`\nHealed ${healed} orphan(s) — now in the review backlog (category null).`);
