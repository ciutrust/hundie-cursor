import { describe, expect, it } from "vitest";
import { categoryDisplayKind } from "@/lib/category-kind";

// C11 — the /categories page must render QB categories that landed with kind = NULL under their
// TRUE P&L kind (derived from full_path), matching what reports compute, instead of dumping them
// all into "unclassified".
describe("categoryDisplayKind", () => {
  it("passes through an explicit kind when set", () => {
    expect(categoryDisplayKind({ kind: "income", full_path: "Software" })).toBe("income");
    expect(categoryDisplayKind({ kind: "transfer", full_path: "Anything" })).toBe("transfer");
    // an explicit kind wins even if it disagrees with the path-derived kind
    expect(categoryDisplayKind({ kind: "expense", full_path: "Credit card payment" })).toBe("expense");
  });

  it("derives the kind from full_path when kind is null (QB import gap)", () => {
    expect(categoryDisplayKind({ kind: null, full_path: "Credit card payment" })).toBe("transfer");
    expect(categoryDisplayKind({ kind: null, full_path: "Membership Income" })).toBe("income");
    expect(categoryDisplayKind({ kind: null, full_path: "Mortgage principal payment" })).toBe("liability");
    expect(categoryDisplayKind({ kind: null, full_path: "Software" })).toBe("expense");
  });

  it("derives 'unclassified' only for a truly blank/null path with a null kind", () => {
    expect(categoryDisplayKind({ kind: null, full_path: "" })).toBe("unclassified");
  });
});
