import {
  parseCsv,
  rowsToObjects,
  parseUsDate,
  parseAmount,
  normalizeDescription,
} from "./csv-utils.mjs";

const PAYMENT_PATTERN = /online payment|payment, thank you|autopay/i;

/**
 * Citi card export.
 * Columns: Status, Date, Description, Debit, Credit [, Member Name]
 */
export function parseCitiCsv(csvText) {
  const rows = rowsToObjects(parseCsv(csvText));
  const transactions = [];

  for (const [index, row] of rows.entries()) {
    const transactionDate = parseUsDate(row.Date);
    const description = normalizeDescription(row.Description);
    const debit = parseAmount(row.Debit);
    const credit = parseAmount(row.Credit);

    if (!transactionDate || !description) continue;
    if (PAYMENT_PATTERN.test(description)) continue;

    let amount;
    if (debit != null && debit > 0) {
      amount = debit; // charge
    } else if (credit != null && credit > 0) {
      amount = -credit; // refund -> negative (C2)
    } else {
      continue;
    }

    transactions.push({
      transactionDate,
      postedDate: transactionDate,
      amount,
      description,
      vendor: description,
      rawCategory: null,
      sourceRowIndex: index + 2,
    });
  }

  return transactions;
}
