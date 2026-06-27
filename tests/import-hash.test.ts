import { describe, expect, it } from "vitest";
import {
  buildTransactionDedupeKey,
  buildTransactionHash,
  dedupeImportPlanRows,
} from "../scripts/lib/import-hash.mjs";

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

  it("ignores source row index so re-imports dedupe", () => {
    const a = buildTransactionHash({ ...base, sourceRowIndex: 10 });
    const b = buildTransactionHash({ ...base, sourceRowIndex: 11 });
    expect(a).toBe(b);
  });

  it("includes issuer reference when present", () => {
    const withoutRef = buildTransactionHash(base);
    const withRef = buildTransactionHash({ ...base, issuerReference: "CHK123" });
    expect(withRef).not.toBe(withoutRef);
  });

  it("differs for distinct charges on the same day", () => {
    const a = buildTransactionHash({ ...base, amount: 3.5, description: "COFFEE SHOP A" });
    const b = buildTransactionHash({ ...base, amount: 3.5, description: "COFFEE SHOP B" });
    expect(a).not.toBe(b);
  });
});

describe("buildTransactionDedupeKey", () => {
  it("normalizes description casing and whitespace", () => {
    const a = buildTransactionDedupeKey({
      accountId: "acct-1",
      transactionDate: "2026-01-15",
      amount: 199,
      description: "  SPARK   MEMBERSHIP  ",
    });
    const b = buildTransactionDedupeKey({
      accountId: "acct-1",
      transactionDate: "2026-01-15",
      amount: 199,
      description: "spark membership",
    });
    expect(a).toBe(b);
  });
});

describe("dedupeImportPlanRows", () => {
  it("keeps the first row when two share a business key", () => {
    const row = (description: string) => ({
      transaction: {
        transaction_date: "2026-06-24",
        amount: 199,
        description,
      },
    });

    const { rows, skipped } = dedupeImportPlanRows("acct-1", [
      row("SPARK MEMBERSHIP"),
      row("spark membership"),
    ]);

    expect(rows).toHaveLength(1);
    expect(skipped).toBe(1);
  });
});
