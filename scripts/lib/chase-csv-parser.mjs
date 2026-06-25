import {
  parseCsv,
  rowsToObjects,
  parseUsDate,
  parseAmount,
  normalizeDescription,
} from "./csv-utils.mjs";

/**
 * Chase card export.
 * Columns: Transaction Date, Post Date, Description, Category, Type, Amount, Memo
 */
export function parseChaseCsv(csvText) {
  const rows = rowsToObjects(parseCsv(csvText));
  const transactions = [];

  for (const row of rows) {
    const transactionDate = parseUsDate(row["Transaction Date"]);
    const postedDate = parseUsDate(row["Post Date"]) ?? transactionDate;
    const description = normalizeDescription(row.Description);
    const type = row.Type?.trim() ?? "";
    const rawAmount = parseAmount(row.Amount);
    const category = row.Category?.trim() ?? "";

    if (!transactionDate || !description || rawAmount == null) continue;
    if (type === "Payment") continue;
    if (type === "Return") continue;
    if (rawAmount >= 0) continue;

    transactions.push({
      transactionDate,
      postedDate,
      amount: Math.abs(rawAmount),
      description,
      vendor: description,
      rawCategory: category || null,
    });
  }

  return transactions;
}
