import {
  parseCsv,
  rowsToObjects,
  parseUsDate,
  parseAmount,
  normalizeDescription,
} from "./csv-utils.mjs";

const PAYMENT_PATTERN = /payment - thank you|mobile payment|autopay|credit balance refund/i;

/**
 * American Express card export.
 * Columns: Date, Description, Card Member, Account #, Amount, ...
 */
export function parseAmexCsv(csvText) {
  const rows = rowsToObjects(parseCsv(csvText));
  const transactions = [];

  for (const [index, row] of rows.entries()) {
    const transactionDate = parseUsDate(row.Date);
    const description = normalizeDescription(row.Description);
    const amount = parseAmount(row.Amount);
    const category = row.Category?.trim() ?? "";

    if (!transactionDate || !description || amount == null) continue;
    if (PAYMENT_PATTERN.test(description)) continue;
    if (amount <= 0) continue;

    transactions.push({
      transactionDate,
      postedDate: transactionDate,
      amount,
      description,
      vendor: row["Appears On Your Statement As"]?.trim() || description,
      rawCategory: category || null,
      issuerReference: row["Account #"]?.trim() || null,
      sourceRowIndex: index + 2,
    });
  }

  return transactions;
}
