import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCardCsv, KNOWN_ACCOUNTS } from "./lib/card-parsers.mjs";
import { buildTransactionHash } from "./lib/import-hash.mjs";
import { resolveEntitySlug } from "./lib/entity-resolver.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const envPath = resolve(root, ".env.local");
const outDir = resolve(__dirname, ".card-import-sql");

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

function sqlString(value) {
  if (value == null) return "null";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function resolveDefaultPath(relativePath) {
  return resolve(process.env.HOME ?? "", relativePath);
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  console.error("Set Supabase URL and publishable key in .env.local");
  process.exit(1);
}

const supabase = createClient(url, key);

const { data: accounts, error: accountsError } = await supabase
  .from("accounts")
  .select(
    `
    id,
    slug,
    display_name,
    account_type,
    issuer_parser,
    date_rules,
    default_entity_id,
    default_entity:entities!accounts_default_entity_id_fkey ( id, slug )
  `,
  )
  .order("display_name");

if (accountsError) {
  console.error("Failed to load accounts:", accountsError.message);
  process.exit(1);
}

const { data: entities, error: entitiesError } = await supabase.from("entities").select("id, slug");
if (entitiesError) {
  console.error("Failed to load entities:", entitiesError.message);
  process.exit(1);
}

const entityMap = new Map((entities ?? []).map((entity) => [entity.slug, entity.id]));
const accountBySlug = new Map((accounts ?? []).map((account) => [account.slug, account]));

mkdirSync(outDir, { recursive: true });

let fileIndex = 0;
const summary = [];

for (const known of KNOWN_ACCOUNTS) {
  const account = accountBySlug.get(known.slug);
  const csvPath = resolveDefaultPath(known.defaultPath);

  if (!account) {
    console.warn(`Skip ${known.slug}: account missing in DB`);
    continue;
  }

  if (!existsSync(csvPath)) {
    console.warn(`Skip ${known.slug}: CSV missing`);
    continue;
  }

  const csvText = readFileSync(csvPath, "utf8");
  const parsed = parseCardCsv(csvText, account);
  const rows = parsed.map((tx) => {
    const entitySlug = resolveEntitySlug(account, tx.transactionDate);
    const entityId = entitySlug ? entityMap.get(entitySlug) : account.default_entity_id;
    const importHash = buildTransactionHash({
      accountId: account.id,
      transactionDate: tx.transactionDate,
      amount: tx.amount,
      description: tx.description,
    });

    return { tx, entityId, importHash };
  });

  const dates = rows.map((row) => row.tx.transactionDate).sort();
  summary.push({
    slug: known.slug,
    count: rows.length,
    dateMin: dates[0] ?? null,
    dateMax: dates.at(-1) ?? null,
  });

  fileIndex += 1;
  const batchId = randomUUID();
  const batchFile = resolve(outDir, `${String(fileIndex).padStart(2, "0")}-${known.slug}-batch.sql`);
  const txFile = resolve(outDir, `${String(fileIndex).padStart(2, "0")}-${known.slug}-transactions.sql`);
  const classFile = resolve(outDir, `${String(fileIndex).padStart(2, "0")}-${known.slug}-classifications.sql`);

  writeFileSync(
    batchFile,
    `insert into import_batches (id, source_type, source_file, account_id, entity_id, row_count)
values (${sqlString(batchId)}, 'card_csv', ${sqlString(basename(csvPath))}, ${sqlString(account.id)}, ${sqlString(account.default_entity_id)}, ${rows.length});`,
  );

  const txStatements = [];
  for (const batch of chunk(rows, 100)) {
    const values = batch
      .map(({ tx, importHash }) => {
        return `(
          ${sqlString(account.id)},
          ${sqlString(batchId)},
          ${sqlString(tx.transactionDate)},
          ${sqlString(tx.postedDate)},
          ${tx.amount.toFixed(2)},
          ${sqlString(tx.description)},
          ${sqlString(tx.vendor)},
          ${tx.rawCategory ? sqlString(tx.rawCategory) : "null"},
          ${sqlString(importHash)}
        )`;
      })
      .join(",\n");

    txStatements.push(`insert into transactions (
  account_id, import_batch_id, transaction_date, posted_date, amount, description, vendor, raw_category, import_hash
)
values
${values}
on conflict (account_id, import_hash) do nothing;`);
  }

  writeFileSync(txFile, txStatements.join("\n\n"));

  const entityIds = [...new Set(rows.map((row) => row.entityId))];
  let classSql;

  if (entityIds.length === 1) {
    classSql = `insert into classifications (transaction_id, entity_id, category_id, classified_by)
select t.id, ${sqlString(entityIds[0])}::uuid, null, 'import'
from transactions t
where t.import_batch_id = ${sqlString(batchId)}
on conflict (transaction_id) do nothing;`;
  } else {
    const cases = rows
      .map(({ importHash, entityId }) => `when ${sqlString(importHash)} then ${sqlString(entityId)}::uuid`)
      .join("\n    ");

    classSql = `insert into classifications (transaction_id, entity_id, category_id, classified_by)
select
  t.id,
  case t.import_hash
    ${cases}
  end,
  null,
  'import'
from transactions t
where t.import_batch_id = ${sqlString(batchId)}
on conflict (transaction_id) do nothing;`;
  }

  writeFileSync(classFile, classSql);
  console.log(`Generated SQL for ${known.slug} (${rows.length} rows)`);
}

writeFileSync(resolve(outDir, "summary.json"), JSON.stringify(summary, null, 2));
console.log(`\nWrote SQL to ${outDir}`);
