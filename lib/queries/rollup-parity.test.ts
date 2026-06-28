import { describe, expect, it } from "vitest";
import {
  countsAsExpense,
  isBookedOperatingExpense,
  sumBookedOperatingExpense,
} from "@/lib/category-expense";
import { needsCategoryReview } from "@/lib/category-review";

/**
 * BUG-04 + QA-01: /review (getEntitySummaries) and /reports (matrix, income, YoY, CSV) must reduce
 * the SAME expense number. Each call site's inline reduce is replicated here against one shared
 * fixture; every replica must equal sumBookedOperatingExpense(rows) so the screens cannot drift.
 */
type Row = { amount: number; categoryFullPath: string | null };

const ROWS: Row[] = [
  { amount: 1000, categoryFullPath: "Rent Expense" }, // expense
  { amount: 250, categoryFullPath: "Meals" }, // expense
  { amount: -100, categoryFullPath: "Meals" }, // expense refund (nets)
  { amount: 500, categoryFullPath: "Ask My Accountant" }, // AMA (review)
  { amount: 300, categoryFullPath: null }, // uncategorized (review)
  { amount: 800, categoryFullPath: "Owner Distribution" }, // funding
  { amount: -2000, categoryFullPath: "Membership Income" }, // income
];

// --- replicas of each call site's inline reduce (filter by predicate, sum SIGNED amount) ---
const reviewExpenseTotal = (rows: Row[]) =>
  rows
    .filter((tx) => isBookedOperatingExpense(tx.categoryFullPath))
    .reduce((sum, tx) => sum + Number(tx.amount), 0);

const monthlyRowYtd = (rows: Row[]) => {
  let ytd = 0;
  for (const tx of rows) {
    if (!isBookedOperatingExpense(tx.categoryFullPath)) continue;
    ytd += Number(tx.amount);
  }
  return ytd;
};

const incomeExpenseTotal = (rows: Row[]) =>
  rows
    .filter((r) => isBookedOperatingExpense(r.categoryFullPath))
    .reduce((sum, r) => sum + Number(r.amount), 0);

const yoyEntityTotal = (rows: Row[]) => {
  let total = 0;
  for (const tx of rows) {
    if (!isBookedOperatingExpense(tx.categoryFullPath)) continue;
    total += Number(tx.amount);
  }
  return total;
};

const reportTransactionsExpenseColumnSum = (rows: Row[]) =>
  rows.reduce((sum, row) => {
    const isBooked = isBookedOperatingExpense(row.categoryFullPath);
    return sum + (isBooked ? Number(row.amount) : 0);
  }, 0);

const entityHomeExpenseTotal = (rows: Row[]) => {
  let expenseTotal = 0;
  for (const tx of rows) {
    if (needsCategoryReview(tx.categoryFullPath)) continue; // review branch (uncat + AMA)
    if (isBookedOperatingExpense(tx.categoryFullPath)) expenseTotal += Number(tx.amount);
  }
  return expenseTotal;
};

describe("/review vs /reports expense parity (BUG-04/QA-01)", () => {
  const expected = 1150; // 1000 + 250 - 100 (refund nets); AMA + uncategorized + funding + income excluded

  it("the shared helper books the netted operating-expense total", () => {
    expect(sumBookedOperatingExpense(ROWS)).toBe(expected);
  });

  it("every call-site reduce equals the shared helper (no drift)", () => {
    expect(reviewExpenseTotal(ROWS)).toBe(expected);
    expect(monthlyRowYtd(ROWS)).toBe(expected);
    expect(incomeExpenseTotal(ROWS)).toBe(expected);
    expect(yoyEntityTotal(ROWS)).toBe(expected);
    expect(reportTransactionsExpenseColumnSum(ROWS)).toBe(expected);
    expect(entityHomeExpenseTotal(ROWS)).toBe(expected);
  });

  it("preserves the positive buckets and locks in that refunds net (gross != net)", () => {
    const positive = ROWS.filter((r) => r.amount > 0);
    const grossTotal = positive.reduce((s, r) => s + r.amount, 0);
    const excludedTotal = positive
      .filter((r) => !needsCategoryReview(r.categoryFullPath) && !countsAsExpense(r.categoryFullPath))
      .reduce((s, r) => s + r.amount, 0);
    const unclassifiedTotal = positive
      .filter((r) => needsCategoryReview(r.categoryFullPath))
      .reduce((s, r) => s + r.amount, 0);
    const positiveExpense = positive
      .filter((r) => isBookedOperatingExpense(r.categoryFullPath))
      .reduce((s, r) => s + r.amount, 0);

    expect(grossTotal).toBe(2850);
    expect(excludedTotal).toBe(800); // Owner Distribution (income -2000 is negative -> not positive)
    expect(unclassifiedTotal).toBe(800); // AMA 500 + uncategorized 300
    expect(positiveExpense).toBe(1250); // 1000 + 250 (positive only)
    // positive buckets reconcile gross; expenseTotal is the NET number and differs from gross.
    expect(positiveExpense + excludedTotal + unclassifiedTotal).toBe(grossTotal);
    expect(sumBookedOperatingExpense(ROWS)).not.toBe(positiveExpense);
  });
});
