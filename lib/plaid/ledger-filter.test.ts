import { describe, expect, test } from "vitest";
import { shouldImportPlaidTxn, summarizePlaidDrops } from "./ledger-filter";

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

  test("keeps checking money-in so income can be captured and classified", () => {
    expect(
      shouldImportPlaidTxn(
        { ...base, amount: -2000, rawCategory: "INCOME", description: "DIRECT DEP PAYROLL" },
        "checking",
      ),
    ).toBe(true);
  });

  test("keeps a checking outflow (a real expense)", () => {
    expect(
      shouldImportPlaidTxn({ ...base, amount: 80, description: "CITY ELECTRIC" }, "checking"),
    ).toBe(true);
  });

  test("drops a pending transaction", () => {
    expect(shouldImportPlaidTxn({ ...base, pending: true }, "credit_card")).toBe(false);
  });

  test("drops a credit-card charge Plaid mis-tagged as INCOME (the Citi case)", () => {
    expect(
      shouldImportPlaidTxn(
        { ...base, amount: -200, rawCategory: "INCOME", description: "06/25 ALPHA MENS HEALTH 200.00" },
        "credit_card",
      ),
    ).toBe(false);
  });

  test("keeps depository INCOME (real income on checking, not a card)", () => {
    expect(
      shouldImportPlaidTxn(
        { ...base, amount: -2000, rawCategory: "INCOME", description: "DIRECT DEP PAYROLL" },
        "checking",
      ),
    ).toBe(true);
  });

  // C12: the payment-name drop must only apply to card accounts. On depository accounts these
  // are legitimate rows (rent income, mortgage debits) the app wants for income capture.
  describe("C12 — payment-name drop scoped to card accounts", () => {
    test("keeps a Zelle rent payment on checking (income capture)", () => {
      expect(
        shouldImportPlaidTxn(
          { ...base, amount: -1500, rawCategory: null, description: "ZELLE PAYMENT FROM TENANT" },
          "checking",
        ),
      ).toBe(true);
    });

    test("drops the same Zelle-named row on a credit card", () => {
      expect(
        shouldImportPlaidTxn(
          { ...base, amount: -1500, rawCategory: null, description: "ZELLE PAYMENT FROM TENANT" },
          "credit_card",
        ),
      ).toBe(false);
    });

    test("keeps an AUTO PAY mortgage debit on checking (counted expense)", () => {
      expect(
        shouldImportPlaidTxn(
          { ...base, amount: 2000, rawCategory: null, description: "AUTO PAY" },
          "checking",
        ),
      ).toBe(true);
    });

    test("drops a real card payment (AUTOPAY PAYMENT THANK YOU) on credit_card", () => {
      expect(
        shouldImportPlaidTxn(
          { ...base, amount: -500, rawCategory: null, description: "AUTOPAY PAYMENT THANK YOU" },
          "credit_card",
        ),
      ).toBe(false);
    });

    test("keeps a normal card charge on credit_card (unaffected)", () => {
      expect(
        shouldImportPlaidTxn(
          { ...base, amount: 42, rawCategory: "FOOD_AND_DRINK", description: "STARBUCKS #123" },
          "credit_card",
        ),
      ).toBe(true);
    });

    test("also scopes the drop to accountType 'credit' (not just 'credit_card')", () => {
      expect(
        shouldImportPlaidTxn(
          { ...base, amount: -500, rawCategory: null, description: "ONLINE PMT THANK YOU" },
          "credit",
        ),
      ).toBe(false);
    });
  });
});

// C12: pure drop-count tally so a caller can log per-import visibility without making
// shouldImportPlaidTxn/classifyPlaidDrop impure.
describe("summarizePlaidDrops — pure drop-count tally (C12 logging)", () => {
  test("tallies kept vs dropped with per-reason counts on a checking account", () => {
    const txns = [
      { ...base, amount: -1500, rawCategory: null, description: "ZELLE PAYMENT FROM TENANT" }, // kept (checking)
      { ...base, amount: 2000, rawCategory: null, description: "AUTO PAY" }, // kept (checking)
      { ...base, amount: 0, rawCategory: null, description: "AUTH HOLD" }, // dropped: zero
      { ...base, amount: -500, rawCategory: "LOAN_PAYMENTS", description: "ACH ELECTRONIC" }, // dropped: pfc
      { ...base, pending: true, amount: 10, rawCategory: null, description: "PENDING CHARGE" }, // dropped: pending
    ];
    const summary = summarizePlaidDrops(txns, "checking");
    expect(summary.kept).toBe(2);
    expect(summary.dropped).toBe(3);
    expect(summary.reasons).toEqual({ pending: 1, zero: 1, pfc: 1, payment: 0, card_income: 0 });
  });

  test("tallies a card-account payment drop and collects sample descriptions", () => {
    const txns = [
      { ...base, amount: -500, rawCategory: null, description: "AUTOPAY PAYMENT THANK YOU" },
      { ...base, amount: -200, rawCategory: "INCOME", description: "MIS-SIGNED CHARGE" },
      { ...base, amount: 42, rawCategory: "FOOD_AND_DRINK", description: "STARBUCKS #123" }, // kept
    ];
    const summary = summarizePlaidDrops(txns, "credit_card");
    expect(summary.kept).toBe(1);
    expect(summary.dropped).toBe(2);
    expect(summary.reasons.payment).toBe(1);
    expect(summary.reasons.card_income).toBe(1);
    expect(summary.samples.payment).toEqual(["AUTOPAY PAYMENT THANK YOU"]);
    expect(summary.samples.card_income).toEqual(["MIS-SIGNED CHARGE"]);
  });

  test("caps samples per reason (does not grow unbounded)", () => {
    const txns = Array.from({ length: 10 }, (_, i) => ({
      ...base,
      amount: -100,
      rawCategory: null,
      description: `AUTOPAY PAYMENT ${i}`,
    }));
    const summary = summarizePlaidDrops(txns, "credit_card");
    expect(summary.reasons.payment).toBe(10);
    expect(summary.samples.payment?.length).toBeLessThanOrEqual(3);
  });

  test("empty input yields all-zero summary", () => {
    const summary = summarizePlaidDrops([], "checking");
    expect(summary).toEqual({
      kept: 0,
      dropped: 0,
      reasons: { pending: 0, zero: 0, pfc: 0, payment: 0, card_income: 0 },
      samples: {},
    });
  });
});
