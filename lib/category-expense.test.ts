import { describe, expect, it } from "vitest";
import {
  countsAsExpense,
  isOperatingExpense,
  NON_EXPENSE_CATEGORY_PATHS,
} from "@/lib/category-expense";

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
