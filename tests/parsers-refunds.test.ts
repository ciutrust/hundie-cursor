import { describe, expect, test } from "vitest";
import { parseWellsFargoCsv } from "../scripts/lib/wf-csv-parser.mjs";
import { parseChaseCsv } from "../scripts/lib/chase-csv-parser.mjs";
import { parseAmexCsv } from "../scripts/lib/amex-csv-parser.mjs";
import { parseCapitalOneCsv } from "../scripts/lib/capitalone-csv-parser.mjs";
import { parseCitiCsv } from "../scripts/lib/citi-csv-parser.mjs";

// C2: refunds/credits enter the ledger as NEGATIVE amounts (visible, classifiable, excluded from
// amount>0 expense totals). Charges stay positive. Card PAYMENTS stay dropped.
// Income capture (Phase 3): checking/savings DEPOSITS are now captured as NEGATIVE inflows so income
// can be classified (kind=income). Card payments and $0 noise are still dropped.

function byDesc(txs: Array<{ description: string; amount: number }>, needle: string) {
  return txs.find((t) => t.description.toUpperCase().includes(needle));
}

describe("Wells Fargo refunds", () => {
  const csv = [
    "DATE,DESCRIPTION,AMOUNT,CHECK #,STATUS",
    "01/15/2026,STARBUCKS STORE 123,-5.50,,posted", // charge (negative in export)
    "01/16/2026,STARBUCKS REFUND,5.50,,posted", // refund (positive in export)
    "01/17/2026,ONLINE PAYMENT THANK YOU,500.00,,posted", // card payment
    "01/18/2026,ZERO AUTH HOLD,0.00,,posted", // $0 noise row
  ].join("\n");

  test("credit card: charge positive, refund negative, payment and $0 rows dropped", () => {
    const txs = parseWellsFargoCsv(csv, { accountType: "credit_card" });
    expect(byDesc(txs, "STARBUCKS STORE")?.amount).toBe(5.5);
    expect(byDesc(txs, "STARBUCKS REFUND")?.amount).toBe(-5.5);
    expect(byDesc(txs, "PAYMENT")).toBeUndefined();
    expect(byDesc(txs, "ZERO AUTH")).toBeUndefined();
  });

  // C12: payment-name rows are legitimate on a depository account (rent income via Zelle, a
  // mortgage AUTO PAY debit) and must now be KEPT there — the drop is scoped to card accounts only.
  test("checking: deposit (income) captured as inflow (negative); outflow positive; payment-named rows KEPT (income capture, C12)", () => {
    const checkingCsv = [
      "DATE,DESCRIPTION,AMOUNT,CHECK #,STATUS",
      "01/18/2026,RENTAL INCOME DEPOSIT,1200.00,,posted",
      "01/15/2026,OFFICE DEPOT,-40.00,,posted",
      "01/17/2026,ONLINE PAYMENT THANK YOU,500.00,,posted", // C12: no longer a card, so KEPT
    ].join("\n");
    const txs = parseWellsFargoCsv(checkingCsv, { accountType: "checking" });
    expect(byDesc(txs, "RENTAL INCOME")?.amount).toBe(-1200);
    expect(byDesc(txs, "OFFICE DEPOT")?.amount).toBe(40);
    expect(byDesc(txs, "THANK YOU")).toBeDefined();
    expect(byDesc(txs, "THANK YOU")?.amount).toBe(-500); // deposit into checking -> ledger inflow
  });

  test("BUG-12: credit_card and checking produce identical signs for the same rows (no dead branch divergence)", () => {
    // C12 (finding, not BUG-12): the payment-name drop is now scoped to card accounts, so this
    // fixture's payment row diverges by design between the two account types (dropped on
    // credit_card, kept on checking) — exclude it and compare sign parity on the remaining rows.
    const cc = parseWellsFargoCsv(csv, { accountType: "credit_card" });
    const chk = parseWellsFargoCsv(csv, { accountType: "checking" });
    const sig = (txs: Array<{ description: string; amount: number }>) =>
      txs
        .filter((t) => !t.description.toUpperCase().includes("PAYMENT"))
        .map((t) => [t.description, t.amount])
        .sort();
    expect(sig(chk)).toEqual(sig(cc));
    // The payment row itself: dropped on credit_card, kept (as an inflow) on checking.
    expect(byDesc(cc, "PAYMENT")).toBeUndefined();
    expect(byDesc(chk, "PAYMENT")?.amount).toBe(-500);
  });
});

describe("Chase refunds", () => {
  const csv = [
    "Transaction Date,Post Date,Description,Category,Type,Amount,Memo",
    "01/15/2026,01/16/2026,WALMART,Shopping,Sale,-20.00,",
    "01/16/2026,01/17/2026,WALMART REFUND,Shopping,Return,20.00,",
    "01/17/2026,01/18/2026,AUTOPAY PAYMENT,,Payment,500.00,",
    "01/19/2026,01/20/2026,STATEMENT CREDIT,Fees & Adjustments,Adjustment,15.00,", // BUG-13
  ].join("\n");

  test("charge positive, return negative, payment dropped", () => {
    const txs = parseChaseCsv(csv);
    expect(byDesc(txs, "WALMART REFUND")?.amount).toBe(-20);
    expect(byDesc(txs, "WALMART,")?.amount ?? byDesc(txs, "WALMART")?.amount).toBeDefined();
    expect(txs.find((t) => t.description.toUpperCase() === "WALMART")?.amount).toBe(20);
    expect(byDesc(txs, "AUTOPAY")).toBeUndefined();
  });

  test("BUG-13: positive non-Payment/non-Return row is booked as a negative credit, not dropped", () => {
    const txs = parseChaseCsv(csv);
    expect(byDesc(txs, "STATEMENT CREDIT")?.amount).toBe(-15);
    expect(byDesc(txs, "AUTOPAY")).toBeUndefined(); // payment still dropped
  });
});

describe("Amex refunds", () => {
  const csv = [
    "Date,Description,Amount",
    "01/15/2026,UBER EATS,25.00",
    "01/16/2026,UBER EATS CREDIT,-25.00",
    "01/17/2026,PAYMENT - THANK YOU,-500.00",
  ].join("\n");

  test("charge positive, credit negative, payment dropped", () => {
    const txs = parseAmexCsv(csv);
    expect(txs.find((t) => t.description.toUpperCase() === "UBER EATS")?.amount).toBe(25);
    expect(byDesc(txs, "UBER EATS CREDIT")?.amount).toBe(-25);
    expect(byDesc(txs, "THANK YOU")).toBeUndefined();
  });
});

describe("Capital One refunds", () => {
  const csv = [
    "Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit",
    "2026-01-15,2026-01-16,1234,TARGET,Merchandise,30.00,",
    "2026-01-16,2026-01-17,1234,TARGET REFUND,Merchandise,,30.00",
    "2026-01-17,2026-01-18,1234,CAPITAL ONE PAYMENT,Payment/Credit,,500.00",
  ].join("\n");

  test("charge positive, credit negative, payment dropped", () => {
    const txs = parseCapitalOneCsv(csv);
    expect(txs.find((t) => t.description.toUpperCase() === "TARGET")?.amount).toBe(30);
    expect(byDesc(txs, "TARGET REFUND")?.amount).toBe(-30);
    expect(byDesc(txs, "CAPITAL ONE PAYMENT")).toBeUndefined();
  });
});

describe("Citi refunds", () => {
  const csv = [
    "Status,Date,Description,Debit,Credit",
    "Cleared,01/15/2026,COSTCO,45.00,",
    "Cleared,01/16/2026,COSTCO REFUND,,45.00",
    "Cleared,01/17/2026,ONLINE PAYMENT,,500.00",
  ].join("\n");

  test("charge positive, credit negative, payment dropped", () => {
    const txs = parseCitiCsv(csv);
    expect(txs.find((t) => t.description.toUpperCase() === "COSTCO")?.amount).toBe(45);
    expect(byDesc(txs, "COSTCO REFUND")?.amount).toBe(-45);
    expect(byDesc(txs, "ONLINE PAYMENT")).toBeUndefined();
  });
});
