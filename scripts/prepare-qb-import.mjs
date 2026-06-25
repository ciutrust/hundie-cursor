import { readFileSync, writeFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import {
  parseQuickBooksCsv,
  buildCategoryTree,
  buildImportHash,
} from "./lib/qb-csv-parser.mjs";

const csvPath = process.argv[2] ?? resolve(process.env.HOME ?? "", "Downloads/Quickbooks-GBSL-Nov2022-June2026.csv");
const outPath = process.argv[3] ?? resolve("scripts", ".qb-import-batches.json");

const parsed = parseQuickBooksCsv(readFileSync(csvPath, "utf8"));
const categoryTree = buildCategoryTree(parsed.categoryNames);

function sqlString(value) {
  if (value == null) return "null";
  return `'${String(value).replace(/'/g, "''")}'`;
}

const categoryInserts = categoryTree.map((node) => ({
  name: node.name,
  fullPath: node.fullPath,
  parentPath: node.parentPath,
}));

const expenseRows = parsed.expenses.map((expense) => ({
  sourceAccount: expense.sourceAccount,
  transactionDate: expense.transactionDate,
  transactionType: expense.transactionType,
  transactionNum: expense.transactionNum,
  vendorName: expense.vendorName,
  description: expense.description,
  categoryName: expense.categoryName,
  amount: expense.amount,
  importHash: buildImportHash(expense),
}));

writeFileSync(
  outPath,
  JSON.stringify(
    {
      sourceFile: basename(csvPath),
      categoryInserts,
      expenseRows,
    },
    null,
    2,
  ),
);

console.log(`Wrote ${outPath}`);
console.log(`  Categories: ${categoryInserts.length}`);
console.log(`  Expenses: ${expenseRows.length}`);
