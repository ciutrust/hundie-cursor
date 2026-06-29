import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const entityId = "e4c8ad5d-7cce-4304-a058-9905184b1a0b";
const data = JSON.parse(readFileSync(resolve(__dirname, ".qb-import-batches.json"), "utf8"));

function sqlString(value) {
  if (value == null) return "null";
  return `'${String(value).replace(/'/g, "''")}'`;
}

// SEC-07: route entityId through the same escaper as every other interpolated value.
const entityIdLiteral = sqlString(entityId);

const outDir = resolve(__dirname, ".qb-import-sql");
mkdirSync(outDir, { recursive: true });

const categorySql = [`-- categories for ${data.sourceFile}`];
for (const category of data.categoryInserts) {
  const parentSql = category.parentPath
    ? `(select id from categories where entity_id = ${entityIdLiteral} and full_path = ${sqlString(category.parentPath)})`
    : "null";

  categorySql.push(`
insert into categories (entity_id, name, full_path, parent_id)
values (${entityIdLiteral}, ${sqlString(category.name)}, ${sqlString(category.fullPath)}, ${parentSql})
on conflict (entity_id, full_path) do update
set name = excluded.name,
    parent_id = excluded.parent_id,
    updated_at = now();`);
}

writeFileSync(resolve(outDir, "01-categories.sql"), categorySql.join("\n"));

const batchSql = `
insert into import_batches (source_type, source_file, entity_id, row_count)
values ('quickbooks_csv', ${sqlString(data.sourceFile)}, ${entityIdLiteral}, ${data.expenseRows.length})
returning id;
`;

writeFileSync(resolve(outDir, "02-import-batch.sql"), batchSql);

const chunkSize = 400;
const expenseChunks = [];
for (let i = 0; i < data.expenseRows.length; i += chunkSize) {
  expenseChunks.push(data.expenseRows.slice(i, i + chunkSize));
}

expenseChunks.forEach((chunk, index) => {
  const values = chunk
    .map((row) => {
      const categoryIdSql = `(select id from categories where entity_id = ${entityIdLiteral} and full_path = ${sqlString(row.categoryName)})`;
      return `(
        ${entityIdLiteral},
        ${categoryIdSql},
        (select id from import_batches where source_file = ${sqlString(data.sourceFile)} order by imported_at desc limit 1),
        ${sqlString(row.sourceAccount)},
        ${sqlString(row.transactionDate)}::date,
        ${sqlString(row.transactionType)},
        ${sqlString(row.transactionNum)},
        ${sqlString(row.vendorName)},
        ${sqlString(row.description)},
        ${sqlString(row.categoryName)},
        ${row.amount},
        ${sqlString(row.importHash)}
      )`;
    })
    .join(",\n");

  const sql = `
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
values
${values}
on conflict (entity_id, import_hash) do nothing;
`;

  writeFileSync(resolve(outDir, `03-expenses-${String(index + 1).padStart(2, "0")}.sql`), sql);
});

console.log(`Generated SQL in ${outDir}`);
console.log(`  Category statements: ${data.categoryInserts.length}`);
console.log(`  Expense chunks: ${expenseChunks.length}`);
