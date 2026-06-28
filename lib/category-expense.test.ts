import { describe, expect, it } from "vitest";
import {
  countsAsExpense,
  isOperatingExpense,
  NON_EXPENSE_CATEGORY_PATHS,
} from "@/lib/category-expense";
import { categoryKind } from "@/lib/category-kind";

describe("category-expense", () => {
  it("excludes non-expense category paths", () => {
    for (const path of NON_EXPENSE_CATEGORY_PATHS) {
      expect(countsAsExpense(path)).toBe(false);
      expect(isOperatingExpense(100, path)).toBe(false);
    }
  });

  it("counts real expenses", () => {
    expect(isOperatingExpense(50, "Software")).toBe(true);
    expect(isOperatingExpense(-50, "Software")).toBe(false);
  });

  it("matches seeded non-expense paths byte-for-byte", () => {
    const seeded = [
      // transfer
      "Credit card payment",
      "Transfer / Zelle (personal)",
      "Refund / credit",
      "Security deposit movement",
      "→ GBSL business expense",
      "→ Keller business expense",
      "→ Austin ACAA (136 Anita)",
      "→ Pflugerville rental",
      "→ Personal (mis-posted)",
      "Mixed / pending allocation",
      "Sales Tax Payable",
      "Credit card rewards / cash back",
      // funding
      "Intercompany — pending",
      "Owner Contribution",
      "Owner Distribution",
      "Owners Equity",
      "Owners Equity:Owner Distribution",
      // capital
      "Leasehold improvements",
      "Tenant improvement allowance",
      "Property purchase",
    ];
    expect([...NON_EXPENSE_CATEGORY_PATHS].sort()).toEqual(seeded.sort());
  });
});

describe("category-kind", () => {
  it("labels money-movement categories as transfer", () => {
    expect(categoryKind("Credit card payment")).toBe("transfer");
    expect(categoryKind("→ Keller business expense")).toBe("transfer");
    expect(categoryKind("Refund / credit")).toBe("transfer");
  });

  it("labels intercompany as funding", () => {
    expect(categoryKind("Intercompany — pending")).toBe("funding");
  });

  it("defaults real and unknown non-null categories to expense", () => {
    expect(categoryKind("Software")).toBe("expense");
    expect(categoryKind("Rent Expense")).toBe("expense");
  });

  it("treats null/blank categories as unclassified, not expense (ACCT-02)", () => {
    expect(categoryKind(null)).toBe("unclassified");
    expect(categoryKind(undefined)).toBe("unclassified");
    expect(categoryKind("")).toBe("unclassified");
    expect(categoryKind("   ")).toBe("unclassified");
  });

  it("ignores whitespace drift so non-expense paths don't leak into expense (BUG-08)", () => {
    expect(categoryKind("  Credit card payment  ")).toBe("transfer");
    expect(categoryKind("Credit card  payment")).toBe("transfer");
    expect(categoryKind(" Owner Distribution ")).toBe("funding");
    expect(categoryKind("Intercompany —  pending")).toBe("funding");
  });

  it("every non-expense path resolves to a non-expense kind", () => {
    for (const path of NON_EXPENSE_CATEGORY_PATHS) {
      expect(categoryKind(path)).not.toBe("expense");
    }
  });
});

describe("uncategorized rows are excluded from operating expense (ACCT-02)", () => {
  it("a positive null-category row is not an operating expense", () => {
    expect(isOperatingExpense(100, null)).toBe(false);
    expect(isOperatingExpense(100, undefined)).toBe(false);
    expect(countsAsExpense(null)).toBe(false);
  });

  it("a positive real-expense row still counts", () => {
    expect(isOperatingExpense(100, "Software")).toBe(true);
  });
});
