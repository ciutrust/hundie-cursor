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
      "Credit card payment",
      "Transfer / Zelle (personal)",
      "Refund / credit",
      "Intercompany — pending",
      "Security deposit movement",
      "→ GBSL business expense",
      "→ Keller business expense",
      "→ Austin ACAA (136 Anita)",
      "→ Pflugerville rental",
      "→ Personal (mis-posted)",
      "Mixed / pending allocation",
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

  it("defaults real and unknown categories (and null) to expense", () => {
    expect(categoryKind("Software")).toBe("expense");
    expect(categoryKind("Rent Expense")).toBe("expense");
    expect(categoryKind(null)).toBe("expense");
    expect(categoryKind(undefined)).toBe("expense");
  });

  it("every non-expense path resolves to a non-expense kind", () => {
    for (const path of NON_EXPENSE_CATEGORY_PATHS) {
      expect(categoryKind(path)).not.toBe("expense");
    }
  });
});
