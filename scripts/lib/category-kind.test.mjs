import { describe, expect, it } from "vitest";
import { categoryKind } from "./category-kind.mjs";

// Mirrors lib/category-kind.test cases — the two implementations MUST stay in sync
// (scripts/lib/category-kind.mjs is the plain-node twin of lib/category-kind.ts, used by the
// QB .mjs import scripts which run under plain `node` and cannot import the .ts file).
describe("scripts/lib/category-kind.mjs", () => {
  it("labels money-movement categories as transfer", () => {
    expect(categoryKind("Credit card payment")).toBe("transfer");
    expect(categoryKind("→ Keller business expense")).toBe("transfer");
    expect(categoryKind("Refund / credit")).toBe("transfer");
  });

  it("labels intercompany as funding", () => {
    expect(categoryKind("Intercompany — pending")).toBe("funding");
    expect(categoryKind("Owner Distribution")).toBe("funding");
  });

  it("maps capital paths (both Leasehold casings) to capital", () => {
    expect(categoryKind("Leasehold improvements")).toBe("capital");
    expect(categoryKind("Leasehold Improvements")).toBe("capital");
    expect(categoryKind("Property purchase")).toBe("capital");
  });

  it("maps loan principal paydown to liability", () => {
    expect(categoryKind("Mortgage principal payment")).toBe("liability");
    expect(categoryKind("Mortgage principal — primary home")).toBe("liability");
    expect(categoryKind("Ford Motor Credit - F150:Principal")).toBe("liability");
  });

  it("maps Tax Penalty to non_deductible", () => {
    expect(categoryKind("Tax Penalty")).toBe("non_deductible");
  });

  it("maps income paths (incl. the ACAA 136-Anita income leg) to income", () => {
    expect(categoryKind("Membership Income")).toBe("income");
    expect(categoryKind("Intercompany — 136 Anita (income)")).toBe("income");
  });

  it("defaults real and unknown non-null categories to expense", () => {
    expect(categoryKind("Software")).toBe("expense");
    expect(categoryKind("Rent Expense")).toBe("expense");
    // the GBSL 136-Anita expense leg stays a real deductible expense
    expect(categoryKind("Intercompany — 136 Anita")).toBe("expense");
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
});
