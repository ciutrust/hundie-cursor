import { describe, expect, it, vi } from "vitest";

// Importing entity-home.ts pulls in the server Supabase client (next/headers) — mock the module so
// the pure builder can be tested in the node runtime (same pattern as review-matrix.test.ts).
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { buildStatsFromTransactions } from "@/lib/queries/entity-home";

const AMA_ID = "cat-ama";
const cpaReviewIds = new Set([AMA_ID]);

const tx = (
  amount: number,
  categoryId: string | null,
  fullPath: string | null,
): { amount: number; classification: { category_id: string | null; category: { full_path: string } | null } } => ({
  amount,
  classification: {
    category_id: categoryId,
    category: fullPath != null ? { full_path: fullPath } : null,
  },
});

// Mirrors the shared rollup-parity fixture, plus flow-split backlog edge rows.
const ROWS = [
  tx(1000, "cat-rent", "Rent Expense"), // expense
  tx(250, "cat-meals", "Meals"), // expense
  tx(-100, "cat-meals", "Meals"), // expense refund (nets)
  tx(500, AMA_ID, "Ask My Accountant"), // review (AMA) — expense-side backlog
  tx(300, null, null), // review (uncategorized) — expense-side backlog
  tx(-50, null, null), // review (uncategorized) — INCOME-side backlog
  tx(0, null, null), // review, zero amount — counted in total, on NEITHER flow
  tx(800, "cat-dist", "Owner Distribution"), // funding — excluded everywhere
  tx(-2000, "cat-inc", "Membership Income"), // income
];

describe("buildStatsFromTransactions", () => {
  const stats = buildStatsFromTransactions("gbsl", "GBSL", ROWS, cpaReviewIds);

  it("books the netted operating-expense total (refunds net, AMA/uncat/funding/income excluded)", () => {
    expect(stats.expenseTotal).toBe(1150); // 1000 + 250 − 100
  });

  it("books income by category KIND (magnitude sum), and net = income − expenses", () => {
    expect(stats.incomeTotal).toBe(2000);
    expect(stats.netTotal).toBe(850);
  });

  it("splits the backlog by flow and keeps the zero-amount row only in the total", () => {
    expect(stats.unclassifiedExpenseCount).toBe(2); // AMA 500 + uncategorized 300
    expect(stats.unclassifiedExpenseTotal).toBe(800);
    expect(stats.unclassifiedIncomeCount).toBe(1); // −50 inflow
    expect(stats.unclassifiedIncomeTotal).toBe(50);
    expect(stats.unclassifiedCount).toBe(4); // 2 expense + 1 income + 1 zero-amount
    // Historical meaning preserved: unclassifiedTotal is the EXPENSE-side dollars only.
    expect(stats.unclassifiedTotal).toBe(800);
  });

  it("ranks top categories by signed total, positive-only, at most 3", () => {
    expect(stats.topCategories).toEqual([
      { name: "Rent Expense", total: 1000 },
      { name: "Meals", total: 150 }, // 250 − 100 refund nets
    ]);
    // Legacy single-top field is untouched and agrees with the head of the list.
    expect(stats.topCategory).toEqual({ name: "Rent Expense", total: 1000 });
  });

  it("drops a category whose refunds net it to ≤ 0 from top categories", () => {
    const refunded = buildStatsFromTransactions(
      "x",
      "X",
      [tx(100, "cat-a", "Software"), tx(-100, "cat-a", "Software"), tx(20, "cat-b", "Meals")],
      cpaReviewIds,
    );
    expect(refunded.topCategories).toEqual([{ name: "Meals", total: 20 }]);
  });

  it("caps top categories at 3", () => {
    const many = buildStatsFromTransactions(
      "x",
      "X",
      [
        tx(40, "c1", "A"),
        tx(30, "c2", "B"),
        tx(20, "c3", "C"),
        tx(10, "c4", "D"),
      ],
      cpaReviewIds,
    );
    expect(many.topCategories.map((c) => c.name)).toEqual(["A", "B", "C"]);
  });

  it("counts every line (including backlog) in transactionCount", () => {
    expect(stats.transactionCount).toBe(ROWS.length);
  });
});
