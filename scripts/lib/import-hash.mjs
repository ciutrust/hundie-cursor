import { createHash } from "node:crypto";
import { normalizeDescription } from "./csv-utils.mjs";

export function buildTransactionHash({
  accountId,
  transactionDate,
  amount,
  description,
  issuerReference,
  sourceRowIndex,
}) {
  const parts = [
    accountId,
    transactionDate,
    Number(amount).toFixed(2),
    normalizeDescription(description).toLowerCase(),
  ];
  if (issuerReference) {
    parts.push(String(issuerReference).trim());
  } else if (sourceRowIndex != null) {
    parts.push(`row:${sourceRowIndex}`);
  }
  const payload = parts.join("|");

  return createHash("sha256").update(payload).digest("hex");
}
