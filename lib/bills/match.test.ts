import { describe, expect, it } from "vitest";
import {
  detectRecurringBills,
  scoreBillMatch,
  type RecurringTxn,
} from "@/lib/bills/match";

const fixedBill = {
  match_hint: "TXU Energy",
  name: "TXU Electric",
  expected_amount: 142.0,
  amount_varies: false,
};
const instance = { due_date: "2026-07-15", expected_amount: 142.0 };

describe("scoreBillMatch", () => {
  it("matches on vendor + in-tolerance amount + in-window date", () => {
    const result = scoreBillMatch({
      bill: fixedBill,
      instance,
      txn: { vendor: "TXU ENERGY", description: "TXU ENERGY BILL 5551234", amount: 142.5, transaction_date: "2026-07-14" },
    });
    expect(result).not.toBeNull();
    expect(result!.amountMatch).toBe(true);
    expect(result!.withinWindow).toBe(true);
    expect(result!.score).toBeGreaterThan(0.4);
  });

  it("rejects a fixed-amount bill when the charge amount is out of tolerance", () => {
    const result = scoreBillMatch({
      bill: fixedBill,
      instance,
      txn: { vendor: "TXU ENERGY", description: "TXU ENERGY", amount: 300.0, transaction_date: "2026-07-14" },
    });
    expect(result).toBeNull();
  });

  it("ignores the amount for a variable bill (matches on vendor + date only)", () => {
    const result = scoreBillMatch({
      bill: { ...fixedBill, amount_varies: true },
      instance: { ...instance, expected_amount: null },
      txn: { vendor: "TXU ENERGY", description: "TXU ENERGY", amount: 311.87, transaction_date: "2026-07-16" },
    });
    expect(result).not.toBeNull();
    expect(result!.amountMatch).toBe(true);
  });

  it("rejects a charge outside the date window", () => {
    const result = scoreBillMatch({
      bill: fixedBill,
      instance,
      txn: { vendor: "TXU ENERGY", description: "TXU ENERGY", amount: 142.0, transaction_date: "2026-06-01" },
    });
    expect(result).toBeNull();
  });

  it("rejects a different vendor", () => {
    const result = scoreBillMatch({
      bill: fixedBill,
      instance,
      txn: { vendor: "COMCAST", description: "COMCAST XFINITY", amount: 142.0, transaction_date: "2026-07-15" },
    });
    expect(result).toBeNull();
  });

  it("rejects an inflow (income/refund)", () => {
    const result = scoreBillMatch({
      bill: fixedBill,
      instance,
      txn: { vendor: "TXU ENERGY", description: "TXU ENERGY REFUND", amount: -142.0, transaction_date: "2026-07-15" },
    });
    expect(result).toBeNull();
  });
});

function monthly(vendor: string, dates: string[], amounts: number[], category_id: string | null = null): RecurringTxn[] {
  return dates.map((transaction_date, i) => ({
    vendor,
    description: vendor,
    amount: amounts[i],
    transaction_date,
    category_id,
  }));
}

describe("detectRecurringBills", () => {
  it("detects a steady monthly charge with modal due day and median amount", () => {
    const txns = monthly(
      "Netflix",
      ["2026-04-15", "2026-05-15", "2026-06-15", "2026-07-15"],
      [15.99, 15.99, 15.99, 15.99],
      "cat-sub",
    );
    const [candidate, ...rest] = detectRecurringBills({ transactions: txns, today: "2026-07-20" });
    expect(rest).toHaveLength(0);
    expect(candidate.cadence).toBe("monthly");
    expect(candidate.due_day).toBe(15);
    expect(candidate.expected_amount).toBe(15.99);
    expect(candidate.amount_varies).toBe(false);
    expect(candidate.category_id).toBe("cat-sub");
    expect(candidate.sampleCount).toBe(4);
  });

  it("flags variable amounts (utilities) as amount_varies", () => {
    const txns = monthly(
      "City Water",
      ["2026-04-10", "2026-05-10", "2026-06-10", "2026-07-10"],
      [64.0, 88.5, 51.25, 120.0],
    );
    const [candidate] = detectRecurringBills({ transactions: txns, today: "2026-07-20" });
    expect(candidate.cadence).toBe("monthly");
    expect(candidate.amount_varies).toBe(true);
  });

  it("ignores a vendor seen fewer than minOccurrences times", () => {
    const txns = monthly("OneOff", ["2026-07-01"], [50]);
    expect(detectRecurringBills({ transactions: txns, today: "2026-07-20" })).toHaveLength(0);
  });

  it("never suggests recurring income (inflows) as a bill", () => {
    const payroll = monthly(
      "ACME Payroll",
      ["2026-04-30", "2026-05-31", "2026-06-30", "2026-07-15"],
      [-3200, -3200, -3200, -3200],
    );
    expect(detectRecurringBills({ transactions: payroll, today: "2026-07-20" })).toHaveLength(0);
  });

  it("skips a charge series that appears to have stopped months ago", () => {
    const txns = monthly(
      "Old Gym",
      ["2025-10-05", "2025-11-05", "2025-12-05", "2026-01-05"],
      [39, 39, 39, 39],
    );
    expect(detectRecurringBills({ transactions: txns, today: "2026-07-20" })).toHaveLength(0);
  });

  it("skips irregular (non-recurring) spend", () => {
    const txns = monthly(
      "Random Store",
      ["2026-02-03", "2026-02-20", "2026-06-11", "2026-07-02"],
      [22, 140, 8, 60],
    );
    expect(detectRecurringBills({ transactions: txns, today: "2026-07-20" })).toHaveLength(0);
  });
});
