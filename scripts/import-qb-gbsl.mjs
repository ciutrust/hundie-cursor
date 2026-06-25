import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseQuickBooksCsv,
  buildCategoryTree,
  buildImportHash,
} from "./lib/qb-csv-parser.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const envPath = resolve(root, ".env.local");
const DEFAULT_CSV = resolve(process.env.HOME ?? "", "Downloads/Quickbooks-GBSL-Nov2022-June2026.csv");

function loadEnv() {
  if (!existsSync(envPath)) {
    console.error("Missing .env.local — copy from .env.local.example");
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

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL in .env.local");
  process.exit(1);
}

if (!serviceKey) {
  console.error("Set SUPABASE_SERVICE_ROLE_KEY in .env.local for imports (server-only, never commit)");
  process.exit(1);
}

const csvPath = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_CSV;
if (!existsSync(csvPath)) {
  console.error(`CSV not found: ${csvPath}`);
  console.error("Usage: npm run import:qb-gbsl [path/to/export.csv]");
  process.exit(1);
}

const supabase = createClient(url, serviceKey);
const csvText = readFileSync(csvPath, "utf8");
const parsed = parseQuickBooksCsv(csvText);

console.log(`Parsed ${basename(csvPath)}`);
console.log(`  Payment accounts: ${parsed.paymentAccounts.length}`);
console.log(`  Categories: ${parsed.categoryNames.length}`);
console.log(`  Training expenses: ${parsed.expenses.length}`);

const { data: entity, error: entityError } = await supabase
  .from("entities")
  .select("id, name")
  .eq("slug", "gbsl")
  .single();

if (entityError || !entity) {
  console.error("Could not load GBSL entity:", entityError?.message ?? "not found");
  process.exit(1);
}

const { data: batch, error: batchError } = await supabase
  .from("import_batches")
  .insert({
    source_type: "quickbooks_csv",
    source_file: basename(csvPath),
    entity_id: entity.id,
    row_count: parsed.expenses.length,
  })
  .select("id")
  .single();

if (batchError || !batch) {
  console.error("Failed to create import batch:", batchError?.message);
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
        is_active: true,
      },
      { onConflict: "entity_id,full_path" },
    )
    .select("id, full_path")
    .single();

  if (error || !data) {
    console.error(`Failed to upsert category ${node.fullPath}:`, error?.message);
    process.exit(1);
  }

  categoryIdByPath.set(data.full_path, data.id);
}

const rows = parsed.expenses.map((expense) => ({
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

let inserted = 0;
for (const batchRows of chunk(rows, 500)) {
  const { error } = await supabase
    .from("qb_training_expenses")
    .upsert(batchRows, { onConflict: "entity_id,import_hash", ignoreDuplicates: true });

  if (error) {
    console.error("Import failed:", error.message);
    process.exit(1);
  }

  inserted += batchRows.length;
}

const { count, error: countError } = await supabase
  .from("qb_training_expenses")
  .select("*", { count: "exact", head: true })
  .eq("entity_id", entity.id);

if (countError) {
  console.error("Could not verify import count:", countError.message);
  process.exit(1);
}

console.log(`Import complete for ${entity.name}`);
console.log(`  Categories upserted: ${categoryTree.length}`);
console.log(`  Rows processed: ${inserted}`);
console.log(`  Total training expenses in DB: ${count}`);
