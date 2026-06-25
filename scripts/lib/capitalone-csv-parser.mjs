import {
  parseCsv,
  rowsToObjects,
  parseUsDate,
  parseAmount,
  normalizeDescription,
} from "./csv-utils.mjs";

/**
 * Capital One card export.
 * Columns: Transaction Date, Posted Date, Card No., Description, Category, Debit, Credit
 */
export function parseCapitalOneCsv(csvText) {
  const rows = rowsToObjects(parseCsv(csvText));
  const transactions = [];

  for (const row of rows) {
    const transactionDate = parseUsDate(row["Transaction Date"]);
    const postedDate = parseUsDate(row["Posted Date"]) ?? transactionDate;
    const description = normalizeDescription(row.Description);
    const category = row.Category?.trim() ?? "";
    const debit = parseAmount(row.Debit);
    const credit = parseAmount(row.Credit);

    if (!transactionDate || !description) continue;
    if (category === "Payment/Credit" || credit != null) continue;
    if (debit == null || debit <= 0) continue;

    transactions.push({
      transactionDate,
      postedDate,
      amount: debit,
      description,
      vendor: description,
      rawCategory: category || null,
    });
  }

  return transactions;
}
