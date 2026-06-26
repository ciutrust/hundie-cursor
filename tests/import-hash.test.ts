import { describe, expect, it } from "vitest";
import { buildTransactionHash } from "../scripts/lib/import-hash.mjs";

describe("buildTransactionHash", () => {
  const base = {
    accountId: "acct-1",
    transactionDate: "2026-01-15",
    amount: 3.5,
    description: "COFFEE SHOP",
  };

  it("is stable for identical inputs", () => {
    const a = buildTransactionHash(base);
    const b = buildTransactionHash(base);
    expect(a).toBe(b);
  });

  it("differs when source row index differs", () => {
    const a = buildTransactionHash({ ...base, sourceRowIndex: 10 });
    const b = buildTransactionHash({ ...base, sourceRowIndex: 11 });
    expect(a).not.toBe(b);
  });

  it("prefers issuer reference over row index", () => {
    const withRef = buildTransactionHash({ ...base, issuerReference: "CHK123" });
    const withRow = buildTransactionHash({ ...base, sourceRowIndex: 5 });
    expect(withRef).not.toBe(withRow);
  });
});
