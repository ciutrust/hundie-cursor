#!/usr/bin/env node
/**
 * Import Keller Services QBO training data (expenses only).
 *
 * Usage:
 *   node scripts/import-qb-keller.mjs --dry-run
 *   node scripts/import-qb-keller.mjs --apply
 *   node scripts/import-qb-keller.mjs --apply --file ~/Downloads/2025-2026-QBO-Keller\ Services\ LLC_Transaction\ Detail\ by\ Account.csv
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseQuickBooksCsv, buildCategoryTree, buildImportHash } from "./lib/qb-csv-parser.mjs";
import { loadEnvFile, resolveDownloadPath, chunk } from "./lib/ledger-import.mjs";
// Plain-node mirror of lib/category-kind.ts — this .mjs runs under bare `node`, so it CANNOT import
// the .ts lib. Keep scripts/lib/category-kind.mjs in sync with lib/category-kind.ts.
import { categoryKind } from "./lib/category-kind.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const args = process.argv.slice(2);
const dryRun = !args.includes("--apply");
const fileArg = args.includes("--file") ? args[args.indexOf("--file") + 1] : null;
const defaultFile = "2025-2026-QBO-Keller Services LLC_Transaction Detail by Account.csv";
const csvPath = fileArg ? resolve(fileArg) : resolveDownloadPath(defaultFile);

const FROM = args.includes("--from") ? args[args.indexOf("--from") + 1] : "2025-07-01";
const TO = args.includes("--to") ? args[args.indexOf("--to") + 1] : "2026-06-26";

if (!existsSync(csvPath)) {
  console.error(`File not found: ${csvPath}`);
  process.exit(1);
}

const parsed = parseQuickBooksCsv(readFileSync(csvPath, "utf8"));
const expenses = parsed.expenses.filter(
  (row) => row.transactionDate >= FROM && row.transactionDate < TO,
);

console.log(`Keller QBO import: ${basename(csvPath)}`);
console.log(`Range: ${FROM} → ${TO}`);
console.log(`Parsed expenses: ${expenses.length} (of ${parsed.expenses.length} total)`);
console.log(`Payment accounts: ${parsed.paymentAccounts.join(", ")}`);
console.log(`Categories: ${parsed.categoryNames.length}`);
console.log(`Mode: ${dryRun ? "DRY RUN" : "APPLY"}`);

if (dryRun) {
  const byAccount = new Map();
  for (const row of expenses) {
    byAccount.set(row.sourceAccount, (byAccount.get(row.sourceAccount) ?? 0) + 1);
  }
  for (const [name, count] of [...byAccount.entries()].sort()) {
    console.log(`  ${name}: ${count}`);
  }
  process.exit(0);
}

const env = loadEnvFile(resolve(root, ".env.local"));
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, serviceKey);

const { data: entity, error: entityError } = await supabase
  .from("entities")
  .select("id, name")
  .eq("slug", "keller")
  .single();

if (entityError || !entity) {
  console.error("Keller entity not found");
  process.exit(1);
}

const { data: batch, error: batchError } = await supabase
  .from("import_batches")
  .insert({
    source_type: "quickbooks_csv",
    source_file: basename(csvPath),
    entity_id: entity.id,
    row_count: expenses.length,
  })
  .select("id")
  .single();

if (batchError || !batch) {
  console.error("Batch failed:", batchError?.message);
  process.exit(1);
}

const categoryTree = buildCategoryTree(parsed.categoryNames);
const categoryIdByPath = new Map();

for (const node of categoryTree) {
  const parentId = node.parentPath ? categoryIdByPath.get(node.parentPath) ?? null : null;
  const { data, error } = await supabase
    .from("categories")
    .upsert(
      {
        entity_id: entity.id,
        name: node.name,
        parent_id: parentId,
        full_path: node.fullPath,
        kind: categoryKind(node.fullPath),
        is_active: true,
      },
      { onConflict: "entity_id,full_path" },
    )
    .select("id, full_path")
    .single();

  if (error || !data) {
    console.error(`Category upsert failed: ${node.fullPath}`, error?.message);
    process.exit(1);
  }
  categoryIdByPath.set(data.full_path, data.id);
}

const rows = expenses.map((expense) => ({
  entity_id: entity.id,
  category_id: categoryIdByPath.get(expense.categoryName) ?? null,
  import_batch_id: batch.id,
  source_account: expense.sourceAccount,
  transaction_date: expense.transactionDate,
  transaction_type: expense.transactionType,
  transaction_num: expense.transactionNum,
  vendor_name: expense.vendorName,
  description: expense.description,
  category_name: expense.categoryName,
  amount: expense.amount,
  import_hash: buildImportHash(expense),
}));

for (const batchRows of chunk(rows, 500)) {
  const { error } = await supabase
    .from("qb_training_expenses")
    .upsert(batchRows, { onConflict: "entity_id,import_hash", ignoreDuplicates: true });
  if (error) {
    console.error("Import failed:", error.message);
    process.exit(1);
  }
}

console.log(`Imported ${rows.length} Keller training rows for ${entity.name}`);
