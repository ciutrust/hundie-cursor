import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const entityId = "e4c8ad5d-7cce-4304-a058-9905184b1a0b";
const data = JSON.parse(readFileSync(resolve(__dirname, ".qb-import-batches.json"), "utf8"));
const outDir = resolve(__dirname, ".qb-import-sql");
mkdirSync(outDir, { recursive: true });

const chunkSize = 300;

function buildExpenseChunkSql(rows, includeBatch) {
  const json = JSON.stringify(
    rows.map((row) => ({
      source_account: row.sourceAccount,
      transaction_date: row.transactionDate,
      transaction_type: row.transactionType,
      transaction_num: row.transactionNum,
      vendor_name: row.vendorName,
      description: row.description,
      category_name: row.categoryName,
      amount: row.amount,
      import_hash: row.importHash,
    })),
  ).replace(/'/g, "''");

  const batchCte = includeBatch
    ? `
with batch as (
  insert into import_batches (source_type, source_file, entity_id, row_count)
  values ('quickbooks_csv', '${data.sourceFile.replace(/'/g, "''")}', '${entityId}', ${data.expenseRows.length})
  returning id
),`
    : `
with batch as (
  select id from import_batches
  where source_file = '${data.sourceFile.replace(/'/g, "''")}'
  order by imported_at desc
  limit 1
),`;

  return `
${batchCte}
incoming as (
  select *
  from jsonb_to_recordset('${json}'::jsonb) as x(
    source_account text,
    transaction_date date,
    transaction_type text,
    transaction_num text,
    vendor_name text,
    description text,
    category_name text,
    amount numeric,
    import_hash text
  )
)
insert into qb_training_expenses (
  entity_id,
  category_id,
  import_batch_id,
  source_account,
  transaction_date,
  transaction_type,
  transaction_num,
  vendor_name,
  description,
  category_name,
  amount,
  import_hash
)
select
  '${entityId}',
  c.id,
  batch.id,
  incoming.source_account,
  incoming.transaction_date,
  incoming.transaction_type,
  incoming.transaction_num,
  incoming.vendor_name,
  incoming.description,
  incoming.category_name,
  incoming.amount,
  incoming.import_hash
from incoming
cross join batch
left join categories c
  on c.entity_id = '${entityId}'
 and c.full_path = incoming.category_name
on conflict (entity_id, import_hash) do nothing;
`;
}

for (let i = 0; i < data.expenseRows.length; i += chunkSize) {
  const chunk = data.expenseRows.slice(i, i + chunkSize);
  const index = String(Math.floor(i / chunkSize) + 1).padStart(2, "0");
  const sql = buildExpenseChunkSql(chunk, i === 0);
  const outPath = resolve(outDir, `04-expenses-json-${index}.sql`);
  writeFileSync(outPath, sql);
  console.log(`${outPath}: ${chunk.length} rows, ${(sql.length / 1024).toFixed(1)} KB`);
}
