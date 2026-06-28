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
 * @param {{ accountId: string, transactionDate: string, amount: number | string, description: string, issuerReference?: string | number | null, sourceRowIndex?: number }} input
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

/**
 * Derive a distinct, deterministic hash for the Nth occurrence (occurrence >= 1) of an identical
 * import_hash inside a SINGLE file. Occurrence 0 returns the base hash UNCHANGED — so non-duplicate
 * rows (the overwhelming common case) and every pre-existing ledger row keep their original hash, and
 * idempotency/legacy dedup are preserved. Occurrence >= 1 appends the index, giving genuine
 * same-(account|date|amount|description) charges their own stable import_hash instead of colliding on
 * UNIQUE(account_id, import_hash). Because the occurrence order of a re-imported file is reproduced
 * exactly, the same hashes come out → a plain re-import stays a clean no-op (BUG-03).
 */
export function withOccurrence(baseHash, occurrence) {
  if (!occurrence) return baseHash;
  return createHash("sha256").update(`${baseHash}|occurrence:${occurrence}`).digest("hex");
}

/**
 * Occurrence-aware in-file dedup (BUG-03).
 *
 * Previously two rows that shared a business key were collapsed to one — silently LOSING a genuine
 * second identical charge (two coffees, same price, same day). Now nothing is dropped: the 2nd and
 * later rows that share an identity are KEPT and given a distinct import_hash via withOccurrence().
 *
 * Identity is the row's import_hash when present (which already folds in account|date|amount|
 * normalized-description AND, for Plaid, the per-txn issuerReference — so distinct Plaid txns already
 * have distinct hashes and are never suffixed). Rows without a precomputed hash fall back to the
 * business key. `skipped` is retained (call sites destructure it) but is now always 0 — in-file rows
 * are preserved, not skipped; `duplicatesPreserved` reports how many got an occurrence suffix.
 */
export function dedupeImportPlanRows(accountId, rows) {
  const occurrenceByIdentity = new Map();
  const deduped = [];
  let duplicatesPreserved = 0;

  for (const row of rows) {
    const identity =
      row.transaction.import_hash ??
      buildTransactionDedupeKey({
        accountId,
        transactionDate: row.transaction.transaction_date,
        amount: row.transaction.amount,
        description: row.transaction.description,
      });
    const occurrence = occurrenceByIdentity.get(identity) ?? 0;
    occurrenceByIdentity.set(identity, occurrence + 1);
    if (occurrence > 0 && row.transaction.import_hash) {
      row.transaction.import_hash = withOccurrence(row.transaction.import_hash, occurrence);
      duplicatesPreserved++;
    }
    deduped.push(row);
  }

  return { rows: deduped, skipped: 0, duplicatesPreserved };
}
