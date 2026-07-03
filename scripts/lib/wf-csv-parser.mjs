import {
  parseCsv,
  rowsToObjects,
  parseUsDate,
  parseAmount,
  normalizeDescription,
} from "./csv-utils.mjs";

const PAYMENT_PATTERN = /payment|thank you|autopay|online pmt|mobile pmt/i;

/**
 * C12: true only for card accounts. WF is used for BOTH checking and credit_card exports (see
 * seed-accounts.mjs); the payment-name drop below must only fire for cards — paying off a credit
 * card is a transfer, not an expense. On a depository account the SAME name pattern is a
 * legitimate row the app WANTS to keep for income capture (e.g. "ZELLE PAYMENT FROM <tenant>"
 * rent income, "AUTO PAY" mortgage debit, a counted expense).
 */
function isCardAccountType(accountType) {
  return accountType === "credit_card" || accountType === "credit";
}

/**
 * C12: pure per-row drop classifier, shared by the filtering loop and the drop-count summary
 * (parseWellsFargoCsvWithSummary) so the two can never diverge.
 */
function classifyWfDropReason(rawAmount, description, accountType) {
  if (isCardAccountType(accountType) && PAYMENT_PATTERN.test(description)) return "payment";
  if (rawAmount === 0) return "zero"; // $0 noise rows (auth holds); parity with other parsers
  return null;
}

/**
 * Wells Fargo credit card / checking export.
 * Columns: DATE, DESCRIPTION, AMOUNT, CHECK #, STATUS
 */
export function parseWellsFargoCsv(csvText, options = {}) {
  return parseWellsFargoCsvWithSummary(csvText, options).transactions;
}

/**
 * C12: same parse as parseWellsFargoCsv, but also returns a pure drop-count summary (how many
 * rows were dropped and why, plus a few sample descriptions) so a caller can log per-import
 * visibility. The return shape adds a field rather than changing the array contract, so existing
 * callers that treat the result as a transaction array (via parseWellsFargoCsv) are unaffected.
 */
export function parseWellsFargoCsvWithSummary(csvText, { accountType = "credit_card" } = {}) {
  const rows = rowsToObjects(parseCsv(csvText));
  const transactions = [];
  const reasons = { payment: 0, zero: 0 };
  const samples = { payment: [], zero: [] };

  for (const [index, row] of rows.entries()) {
    const transactionDate = parseUsDate(row.DATE);
    const description = normalizeDescription(row.DESCRIPTION);
    const rawAmount = parseAmount(row.AMOUNT);

    if (!transactionDate || !description || rawAmount == null) continue;

    const dropReason = classifyWfDropReason(rawAmount, description, accountType);
    if (dropReason) {
      reasons[dropReason] += 1;
      if (samples[dropReason].length < 3) samples[dropReason].push(description);
      continue;
    }

    // WF posts the SAME sign convention for every export type (credit-card AND checking/savings):
    // outflows/charges are negative, refunds/deposits positive. The ledger stores the inverse
    // (charge positive, money-in negative), so the rule is identical regardless of accountType —
    // one expression, no per-type branch (BUG-12: the two branches were byte-identical, a dead branch
    // / latent sign trap). Income capture is preserved: checking deposits (positive in export) become
    // negative inflows here for kind=income classification. accountType is retained on the signature
    // for callers / future per-type logic.
    const amount = rawAmount < 0 ? Math.abs(rawAmount) : -rawAmount;

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

  const dropped = reasons.payment + reasons.zero;
  return { transactions, dropSummary: { kept: transactions.length, dropped, reasons, samples } };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Wells Fargo Signify parent/child credit cards duplicate charges with slightly
 * different posting dates. Keep child (subaccount) rows and add parent-only rows
 * such as late fees that never appear on the child export.
 *
 * C21: matches must consume child rows one-for-one. A non-consuming `.some()` match would let N
 * identical parent rows all match the SAME single child row, wrongly suppressing N-1 real charges
 * (e.g. two identical $50 charges on the same day against one child row -> one silently lost).
 * Track which child indices are already consumed so each child can suppress at most one parent;
 * surplus parents that find no unconsumed matching child are kept.
 */
export function mergeParentChildCreditCardTransactions(parentTransactions, childTransactions) {
  const merged = [...childTransactions];
  const consumedChildIndices = new Set();

  for (const parentTx of parentTransactions) {
    const matchIndex = childTransactions.findIndex(
      (childTx, index) => !consumedChildIndices.has(index) && isLikelyDuplicateCharge(parentTx, childTx),
    );

    if (matchIndex === -1) {
      merged.push(parentTx); // no unconsumed matching child — surplus/parent-only row, keep it
    } else {
      consumedChildIndices.add(matchIndex);
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
