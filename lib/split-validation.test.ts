import { describe, expect, it } from "vitest";
import { parseAmountToCents } from "./money";
import { remainingCents, validateSplit, type SplitLegDraft } from "./split-validation";

const leg = (entityId: string, categoryId: string | null, amount: string): SplitLegDraft => ({
  entityId,
  categoryId,
  amount,
});

describe("parseAmountToCents", () => {
  it("parses to exact integer cents without float drift", () => {
    expect(parseAmountToCents("533.44")).toBe(53344);
    expect(parseAmountToCents("$1,234.56")).toBe(123456);
    expect(parseAmountToCents("-40")).toBe(-4000);
    expect(parseAmountToCents("0.1")).toBe(10);
  });
  it("rejects junk", () => {
    expect(parseAmountToCents("")).toBeNull();
    expect(parseAmountToCents("abc")).toBeNull();
    expect(parseAmountToCents("-")).toBeNull();
  });
});

describe("validateSplit", () => {
  it("accepts legs that sum to the parent to the cent (the Tri County case)", () => {
    const res = validateSplit(
      [leg("personal", "c1", "568.88"), leg("acaa", "c2", "141.49")],
      710.37,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.legs.map((l) => l.amountCents)).toEqual([56888, 14149]);
      expect(res.legs.reduce((s, l) => s + l.amountCents, 0)).toBe(71037);
    }
  });

  it("rejects when the legs do not sum to the parent, reporting the remainder", () => {
    const res = validateSplit([leg("p", "c1", "568.88"), leg("a", "c2", "100.00")], 710.37);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("Remaining: $41.49");
  });

  it("requires a category on every leg", () => {
    const res = validateSplit([leg("p", "c1", "355.19"), leg("a", null, "355.18")], 710.37);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/category/i);
  });

  it("requires all legs to share the parent sign", () => {
    const res = validateSplit([leg("p", "c1", "810.37"), leg("a", "c2", "-100.00")], 710.37);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/positive/i);
  });

  it("rejects a zero-amount leg and fewer than 2 legs", () => {
    expect(validateSplit([leg("p", "c1", "710.37"), leg("a", "c2", "0")], 710.37).ok).toBe(false);
    expect(validateSplit([leg("p", "c1", "710.37")], 710.37).ok).toBe(false);
  });

  it("handles a negative parent (refund) split into negative legs", () => {
    const res = validateSplit([leg("p", "c1", "-60"), leg("a", "c2", "-40")], -100);
    expect(res.ok).toBe(true);
  });
});

describe("remainingCents", () => {
  it("is 0 when balanced, negative when over-allocated", () => {
    expect(remainingCents([leg("p", "c1", "568.88"), leg("a", "c2", "141.49")], 710.37)).toBe(0);
    expect(remainingCents([leg("p", "c1", "700"), leg("a", "c2", "100")], 710.37)).toBe(-8963);
  });
});
