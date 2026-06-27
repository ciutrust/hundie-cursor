import { describe, expect, test } from "vitest";
import { shouldImportPlaidTxn } from "./ledger-filter";

const base = { amount: 25, description: "STARBUCKS #123", rawCategory: "FOOD_AND_DRINK", pending: false };

describe("shouldImportPlaidTxn — mirrors the CSV parsers' non-expense drop rules", () => {
  test("keeps a credit-card charge (positive)", () => {
    expect(shouldImportPlaidTxn({ ...base, amount: 25 }, "credit_card")).toBe(true);
  });

  test("keeps a credit-card refund (negative, not a payment)", () => {
    expect(
      shouldImportPlaidTxn(
        { ...base, amount: -25, rawCategory: "GENERAL_MERCHANDISE", description: "AMAZON REFUND" },
        "credit_card",
      ),
    ).toBe(true);
  });

  test("drops a credit-card payment by PFC (LOAN_PAYMENTS)", () => {
    expect(
      shouldImportPlaidTxn(
        { ...base, amount: -500, rawCategory: "LOAN_PAYMENTS", description: "ACH ELECTRONIC" },
        "credit_card",
      ),
    ).toBe(false);
  });

  test("drops a payment by name (autopay / thank you)", () => {
    expect(
      shouldImportPlaidTxn(
        { ...base, amount: -500, rawCategory: null, description: "AUTOPAY PAYMENT THANK YOU" },
        "credit_card",
      ),
    ).toBe(false);
  });

  test("drops a $0 auth-hold", () => {
    expect(shouldImportPlaidTxn({ ...base, amount: 0 }, "credit_card")).toBe(false);
  });

  test("drops checking money-in (deposit / income / transfer-in)", () => {
    expect(
      shouldImportPlaidTxn(
        { ...base, amount: -2000, rawCategory: "INCOME", description: "DIRECT DEP PAYROLL" },
        "checking",
      ),
    ).toBe(false);
  });

  test("keeps a checking outflow (a real expense)", () => {
    expect(
      shouldImportPlaidTxn({ ...base, amount: 80, description: "CITY ELECTRIC" }, "checking"),
    ).toBe(true);
  });

  test("drops a pending transaction", () => {
    expect(shouldImportPlaidTxn({ ...base, pending: true }, "credit_card")).toBe(false);
  });
});
