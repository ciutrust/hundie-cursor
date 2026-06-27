import { createHash } from "node:crypto";
import { normalizeDescription } from "./csv-utils.mjs";

/**
 * Stable identity for a ledger row: account + date + amount + normalized description.
 * Used to skip re-imports that differ only by CSV row index or import batch.
 */
export function buildTransactionDedupeKey({
  accountId,
  transactionDate,
  amount,
  description,
}) {
  return [
    accountId,
    transactionDate,
    Number(amount).toFixed(2),
    normalizeDescription(description).toLowerCase(),
  ].join("|");
}

/**
 * Idempotent import key stored on transactions.import_hash.
 * Matches dedupe key; appends issuer reference when present (Plaid id, check #, etc.).
 */
export function buildTransactionHash({
  accountId,
  transactionDate,
  amount,
  description,
  issuerReference,
  // sourceRowIndex ignored — row position must not affect identity
}) {
  const parts = [
    accountId,
    transactionDate,
    Number(amount).toFixed(2),
    normalizeDescription(description).toLowerCase(),
  ];
  if (issuerReference) {
    parts.push(String(issuerReference).trim());
  }
  const payload = parts.join("|");

  return createHash("sha256").update(payload).digest("hex");
}

/** Drop duplicate rows within a single import file/batch. */
export function dedupeImportPlanRows(accountId, rows) {
  const seen = new Set();
  const deduped = [];
  let skipped = 0;

  for (const row of rows) {
    const key = buildTransactionDedupeKey({
      accountId,
      transactionDate: row.transaction.transaction_date,
      amount: row.transaction.amount,
      description: row.transaction.description,
    });
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    deduped.push(row);
  }

  return { rows: deduped, skipped };
}
