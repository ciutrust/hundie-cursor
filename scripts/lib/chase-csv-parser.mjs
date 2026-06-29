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

  for (const [index, row] of rows.entries()) {
    const transactionDate = parseUsDate(row["Transaction Date"]);
    const postedDate = parseUsDate(row["Post Date"]) ?? transactionDate;
    const description = normalizeDescription(row.Description);
    const type = row.Type?.trim() ?? "";
    const rawAmount = parseAmount(row.Amount);
    const category = row.Category?.trim() ?? "";

    if (!transactionDate || !description || rawAmount == null) continue;
    if (type === "Payment") continue;

    let amount;
    if (type === "Return") {
      amount = -Math.abs(rawAmount); // refund -> negative (C2)
    } else if (rawAmount < 0) {
      amount = Math.abs(rawAmount); // charge (negative in Chase export) -> positive
    } else {
      // BUG-13: a positive, non-Payment, non-Return Chase row is a legit credit/adjustment
      // (statement credit, reward redemption, reimbursement). Payments are already dropped above
      // (`type === "Payment"`), so this is money-in. Previously DROPPED (silent transaction loss);
      // now booked as a negative inflow, consistent with the sign convention.
      amount = -Math.abs(rawAmount);
    }

    transactions.push({
      transactionDate,
      postedDate,
      amount,
      description,
      vendor: description,
      rawCategory: category || null,
      sourceRowIndex: index + 2,
    });
  }

  return transactions;
}
