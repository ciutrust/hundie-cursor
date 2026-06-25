import { createHash } from "node:crypto";
import { normalizeDescription } from "./csv-utils.mjs";

export function buildTransactionHash({ accountId, transactionDate, amount, description }) {
  const payload = [
    accountId,
    transactionDate,
    Number(amount).toFixed(2),
    normalizeDescription(description).toLowerCase(),
  ].join("|");

  return createHash("sha256").update(payload).digest("hex");
}
