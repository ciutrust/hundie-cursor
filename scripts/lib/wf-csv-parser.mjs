import {
  parseCsv,
  rowsToObjects,
  parseUsDate,
  parseAmount,
  normalizeDescription,
} from "./csv-utils.mjs";

const PAYMENT_PATTERN = /payment|thank you|autopay|online pmt|mobile pmt/i;

/**
 * Wells Fargo credit card / checking export.
 * Columns: DATE, DESCRIPTION, AMOUNT, CHECK #, STATUS
 */
export function parseWellsFargoCsv(csvText, { accountType = "credit_card" } = {}) {
  const rows = rowsToObjects(parseCsv(csvText));
  const transactions = [];

  for (const [index, row] of rows.entries()) {
    const transactionDate = parseUsDate(row.DATE);
    const description = normalizeDescription(row.DESCRIPTION);
    const rawAmount = parseAmount(row.AMOUNT);

    if (!transactionDate || !description || rawAmount == null) continue;
    if (PAYMENT_PATTERN.test(description)) continue;
    if (rawAmount === 0) continue; // $0 noise rows (auth holds); parity with other parsers

    let amount = null;

    if (accountType === "credit_card") {
      // Charge posts negative; refund/credit posts positive -> store negative (C2).
      amount = rawAmount < 0 ? Math.abs(rawAmount) : -rawAmount;
    } else {
      // Checking: outflows only; deposits/income are out of scope (not refunds).
      if (rawAmount >= 0) continue;
      amount = Math.abs(rawAmount);
    }

    const checkNumber = row["CHECK #"]?.trim();
    transactions.push({
      transactionDate,
      postedDate: transactionDate,
      amount,
      description,
      vendor: extractVendor(description),
      rawCategory: null,
      issuerReference: checkNumber || null,
      sourceRowIndex: index + 2,
    });
  }

  return transactions;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Wells Fargo Signify parent/child credit cards duplicate charges with slightly
 * different posting dates. Keep child (subaccount) rows and add parent-only rows
 * such as late fees that never appear on the child export.
 */
export function mergeParentChildCreditCardTransactions(parentTransactions, childTransactions) {
  const merged = [...childTransactions];

  for (const parentTx of parentTransactions) {
    const isDuplicate = childTransactions.some((childTx) =>
      isLikelyDuplicateCharge(parentTx, childTx),
    );

    if (!isDuplicate) {
      merged.push(parentTx);
    }
  }

  return merged.sort((a, b) => b.transactionDate.localeCompare(a.transactionDate));
}

function isLikelyDuplicateCharge(a, b) {
  if (a.amount !== b.amount || a.description !== b.description) {
    return false;
  }

  const dateDiff = Math.abs(new Date(a.transactionDate).getTime() - new Date(b.transactionDate).getTime());
  return dateDiff <= 3 * DAY_MS;
}

function extractVendor(description) {
  const cleaned = description.replace(/\s+/g, " ").trim();
  const match = cleaned.match(/^([A-Z0-9*][A-Z0-9* .&'-]{2,40})/i);
  return match ? match[1].trim() : cleaned.slice(0, 80);
}
