import { describe, expect, test } from "vitest";
import { mapAccountType, mapTransaction } from "./plaid-map";

// Minimal Plaid Transaction fixture (only the fields the mapper reads).
function plaidTx(over: Record<string, unknown> = {}) {
  return {
    transaction_id: "txn_1",
    account_id: "acct_1",
    date: "2026-03-15",
    authorized_date: "2026-03-14",
    amount: 12.34,
    name: "STARBUCKS #123",
    merchant_name: "Starbucks",
    personal_finance_category: { primary: "FOOD_AND_DRINK" },
    category: ["Food and Drink", "Coffee"],
    pending: false,
    ...over,
  } as never;
}

describe("mapTransaction — this ledger uses positive = charge, so NO sign flip", () => {
  test("a charge maps to a POSITIVE amount", () => {
    expect(mapTransaction(plaidTx({ amount: 12.34 })).amount).toBe(12.34);
  });

  test("a refund/credit (Plaid negative) stays NEGATIVE", () => {
    expect(mapTransaction(plaidTx({ amount: -50 })).amount).toBe(-50);
  });

  test("rounds to 2 decimals", () => {
    expect(mapTransaction(plaidTx({ amount: 9.996 })).amount).toBe(10);
  });

  test("carries ids, prefers authorized_date, keeps posted date, vendor, category, pending", () => {
    const m = mapTransaction(plaidTx());
    expect(m.externalId).toBe("txn_1");
    expect(m.accountExternalId).toBe("acct_1");
    expect(m.transactionDate).toBe("2026-03-14"); // authorized_date preferred
    expect(m.postedDate).toBe("2026-03-15"); // posted date
    expect(m.description).toBe("STARBUCKS #123");
    expect(m.vendor).toBe("Starbucks");
    expect(m.rawCategory).toBe("FOOD_AND_DRINK");
    expect(m.pending).toBe(false);
  });

  test("falls back: transactionDate=date when no authorized_date; category[0]; null merchant", () => {
    const m = mapTransaction(
      plaidTx({ authorized_date: null, merchant_name: null, personal_finance_category: null }),
    );
    expect(m.transactionDate).toBe("2026-03-15");
    expect(m.vendor).toBeNull();
    expect(m.rawCategory).toBe("Food and Drink");
  });
});

describe("mapAccountType", () => {
  test("maps credit / depository / other", () => {
    expect(mapAccountType("credit")).toBe("credit");
    expect(mapAccountType("depository")).toBe("depository");
    expect(mapAccountType("loan")).toBe("other");
  });
});
