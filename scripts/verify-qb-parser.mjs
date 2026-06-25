import { readFileSync } from "node:fs";
import { parseQuickBooksCsv } from "./lib/qb-csv-parser.mjs";

const csvPath = process.argv[2];
if (!csvPath) {
  console.error("Usage: node scripts/verify-qb-parser.mjs path/to/export.csv");
  process.exit(1);
}

const parsed = parseQuickBooksCsv(readFileSync(csvPath, "utf8"));

console.log(`Payment accounts (${parsed.paymentAccounts.length}):`);
for (const account of parsed.paymentAccounts) {
  console.log(`  - ${account}`);
}

console.log(`\nCategories: ${parsed.categoryNames.length}`);
console.log(`Training expenses: ${parsed.expenses.length}`);

const jan2026 = parsed.expenses.filter((row) => row.transactionDate?.startsWith("2026-01"));
console.log(`Jan 2026 expenses: ${jan2026.length}`);

const topCategories = new Map();
for (const row of parsed.expenses) {
  topCategories.set(row.categoryName, (topCategories.get(row.categoryName) ?? 0) + 1);
}

console.log("\nTop categories:");
[...topCategories.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)
  .forEach(([name, count]) => console.log(`  ${count}\t${name}`));
