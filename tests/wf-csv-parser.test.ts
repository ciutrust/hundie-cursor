import { describe, expect, test } from "vitest";
import {
  parseWellsFargoCsv,
  parseWellsFargoCsvWithSummary,
  mergeParentChildCreditCardTransactions,
} from "../scripts/lib/wf-csv-parser.mjs";

function byDesc(txs: Array<{ description: string; amount: number }>, needle: string) {
  return txs.find((t) => t.description.toUpperCase().includes(needle));
}

// C12: the payment-name drop must only apply to card accounts. WF is used for BOTH checking and
// credit_card accounts (see scripts/lib/seed-accounts.mjs — wf-gbsl-checking, wf-personal-checking,
// wf-anita-checking, wf-keller-services-checking, wf-keller-jroots-checking are all `checking`); the
// parser already receives `accountType` from the caller (card-parsers.mjs -> account.account_type),
// so it has real account-type context and must mirror the Plaid gate: drop payment-named rows only
// on card accounts, and KEEP them on depository accounts (ZELLE rent income, AUTO PAY mortgage debit).
describe("C12 — Wells Fargo payment-name drop scoped to card accounts", () => {
  test("keeps a Zelle rent-income deposit on a checking account", () => {
    const csv = [
      "DATE,DESCRIPTION,AMOUNT,CHECK #,STATUS",
      "01/15/2026,ZELLE PAYMENT FROM TENANT,1500.00,,posted",
    ].join("\n");
    const txs = parseWellsFargoCsv(csv, { accountType: "checking" });
    expect(byDesc(txs, "ZELLE PAYMENT")).toBeDefined();
    expect(byDesc(txs, "ZELLE PAYMENT")?.amount).toBe(-1500);
  });

  test("keeps an AUTO PAY mortgage debit on a checking account", () => {
    const csv = [
      "DATE,DESCRIPTION,AMOUNT,CHECK #,STATUS",
      "01/15/2026,AUTO PAY MORTGAGE,-2000.00,,posted",
    ].join("\n");
    const txs = parseWellsFargoCsv(csv, { accountType: "checking" });
    expect(byDesc(txs, "AUTO PAY")).toBeDefined();
    expect(byDesc(txs, "AUTO PAY")?.amount).toBe(2000);
  });

  test("still drops a real card payment on a credit_card account", () => {
    const csv = [
      "DATE,DESCRIPTION,AMOUNT,CHECK #,STATUS",
      "01/17/2026,ONLINE PAYMENT THANK YOU,500.00,,posted",
    ].join("\n");
    const txs = parseWellsFargoCsv(csv, { accountType: "credit_card" });
    expect(byDesc(txs, "PAYMENT")).toBeUndefined();
  });

  test("a normal charge is unaffected on either account type (same sign convention, per BUG-12)", () => {
    const csv = [
      "DATE,DESCRIPTION,AMOUNT,CHECK #,STATUS",
      "01/15/2026,STARBUCKS STORE 123,-5.50,,posted",
    ].join("\n");
    expect(byDesc(parseWellsFargoCsv(csv, { accountType: "credit_card" }), "STARBUCKS")?.amount).toBe(
      5.5,
    );
    expect(byDesc(parseWellsFargoCsv(csv, { accountType: "checking" }), "STARBUCKS")?.amount).toBe(
      5.5,
    );
  });
});

// C12 (logging): dropped WF rows previously left no trace. parseWellsFargoCsvWithSummary exposes a
// pure drop-count tally (mirrors summarizePlaidDrops on the Plaid side) so a caller can log
// per-import visibility without changing parseWellsFargoCsv's existing array-returning contract.
describe("C12 — parseWellsFargoCsvWithSummary drop-count visibility", () => {
  test("tallies payment drops on a credit_card account", () => {
    const csv = [
      "DATE,DESCRIPTION,AMOUNT,CHECK #,STATUS",
      "01/15/2026,STARBUCKS STORE 123,-5.50,,posted",
      "01/17/2026,ONLINE PAYMENT THANK YOU,500.00,,posted",
      "01/18/2026,ZERO AUTH HOLD,0.00,,posted",
    ].join("\n");
    const { transactions, dropSummary } = parseWellsFargoCsvWithSummary(csv, {
      accountType: "credit_card",
    });
    expect(transactions.length).toBe(1);
    expect(dropSummary.kept).toBe(1);
    expect(dropSummary.dropped).toBe(2);
    expect(dropSummary.reasons).toEqual({ payment: 1, zero: 1 });
    expect(dropSummary.samples.payment).toEqual(["ONLINE PAYMENT THANK YOU"]);
  });

  test("does not tally a payment-named row as dropped on a checking account (kept, C12)", () => {
    const csv = [
      "DATE,DESCRIPTION,AMOUNT,CHECK #,STATUS",
      "01/17/2026,ZELLE PAYMENT FROM TENANT,1500.00,,posted",
    ].join("\n");
    const { transactions, dropSummary } = parseWellsFargoCsvWithSummary(csv, {
      accountType: "checking",
    });
    expect(transactions.length).toBe(1);
    expect(dropSummary.dropped).toBe(0);
    expect(dropSummary.reasons).toEqual({ payment: 0, zero: 0 });
  });

  test("parseWellsFargoCsv (array contract) is unaffected — still returns a plain transaction array", () => {
    const csv = [
      "DATE,DESCRIPTION,AMOUNT,CHECK #,STATUS",
      "01/15/2026,STARBUCKS STORE 123,-5.50,,posted",
    ].join("\n");
    const txs = parseWellsFargoCsv(csv, { accountType: "credit_card" });
    expect(Array.isArray(txs)).toBe(true);
    expect(txs.length).toBe(1);
  });
});

// C21: mergeParentChildCreditCardTransactions must consume child matches one-for-one. A non-consuming
// `.some()` match lets N identical parent rows all match the SAME single child row, wrongly
// suppressing N-1 real charges (e.g. two identical $50 charges on the same day against one child row
// -> one silently lost).
describe("C21 — mergeParentChildCreditCardTransactions consumes child matches one-for-one", () => {
  function tx(overrides: Partial<{
    transactionDate: string;
    postedDate: string;
    amount: number;
    description: string;
  }> = {}) {
    return {
      transactionDate: "2026-01-15",
      postedDate: "2026-01-15",
      amount: 50,
      description: "AMAZON.COM",
      vendor: "AMAZON.COM",
      rawCategory: null,
      issuerReference: null,
      sourceRowIndex: 2,
      ...overrides,
    };
  }

  test("two identical parents + one identical child -> 2 rows (1 merged + 1 surplus parent kept)", () => {
    const parents = [tx(), tx()];
    const children = [tx()];
    const merged = mergeParentChildCreditCardTransactions(parents, children);
    expect(merged.length).toBe(2);
    const amazonRows = merged.filter((t) => t.description === "AMAZON.COM");
    expect(amazonRows.length).toBe(2);
  });

  test("one parent + one matching child -> 1 row (unchanged behavior)", () => {
    const parents = [tx()];
    const children = [tx()];
    const merged = mergeParentChildCreditCardTransactions(parents, children);
    expect(merged.length).toBe(1);
  });

  test("a parent-only late fee (no matching child) always survives", () => {
    const parents = [tx({ description: "LATE FEE", amount: 35 })];
    const children = [tx()]; // unrelated child (different description/amount)
    const merged = mergeParentChildCreditCardTransactions(parents, children);
    expect(byDesc(merged, "LATE FEE")).toBeDefined();
    expect(merged.length).toBe(2); // the unrelated child + the surviving parent-only late fee
  });

  test("three identical parents + two identical children -> 3 rows (2 merged + 1 surplus parent)", () => {
    const parents = [tx(), tx(), tx()];
    const children = [tx(), tx()];
    const merged = mergeParentChildCreditCardTransactions(parents, children);
    const amazonRows = merged.filter((t) => t.description === "AMAZON.COM");
    expect(amazonRows.length).toBe(3);
  });
});
