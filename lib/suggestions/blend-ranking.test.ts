import { describe, expect, it } from "vitest";
import {
  mergeWeightedSuggestions,
  recencyWeight,
  resolveConfidence,
  resolvePrimarySource,
} from "@/lib/suggestions/blend-ranking";

describe("blend-ranking", () => {
  it("weights recent ledger rows higher", () => {
    expect(recencyWeight("2026-06-01", new Date("2026-06-15"))).toBe(3);
    expect(recencyWeight("2026-05-01", new Date("2026-06-15"))).toBe(2);
    expect(recencyWeight("2024-01-01", new Date("2026-06-15"))).toBe(1);
  });

  it("returns matchCount from real occurrences not blended score", () => {
    const suggestions = mergeWeightedSuggestions(
      [],
      [
        {
          category_id: "c1",
          category: { id: "c1", full_path: "Software" },
          transaction_date: "2026-06-01",
        },
        {
          category_id: "c1",
          category: { id: "c1", full_path: "Software" },
          transaction_date: "2026-06-02",
        },
      ],
      [],
    );
    expect(suggestions[0]?.count).toBe(2);
  });

  it("credits the chosen category when an AI suggestion is overridden (reject event)", () => {
    // An override logs as a 'reject' of the AI pick with chosen_category_id = the
    // operator's category. That choice must reinforce the engine, not be missed.
    const suggestions = mergeWeightedSuggestions(
      [],
      [],
      [
        {
          suggested_category_id: "ai-pick",
          chosen_category_id: "override-y",
          event_type: "reject",
          created_at: "2026-06-10",
          chosen: { id: "override-y", full_path: "Mortgage payment" },
        },
      ],
    );
    const overridden = suggestions.find((s) => s.categoryId === "override-y");
    expect(overridden).toBeDefined();
    expect(overridden!.fullPath).toBe("Mortgage payment");
  });
});

// OPT-09: pin the extracted source/confidence helpers so the former nested ternaries stay equivalent.
describe("resolvePrimarySource", () => {
  const base = { qbScore: 0, ledgerScore: 0, eventScore: 0, amountScore: 0 };

  it("amount wins when positive and >= every other source", () => {
    expect(resolvePrimarySource({ ...base, amountScore: 6 })).toBe("amount_match");
  });

  it("a smaller amount score does not win — ledger does", () => {
    expect(resolvePrimarySource({ ...base, amountScore: 1, ledgerScore: 5 })).toBe(
      "confirmed_history",
    );
  });

  it("ledger-only is confirmed_history", () => {
    expect(resolvePrimarySource({ ...base, ledgerScore: 3 })).toBe("confirmed_history");
  });

  it("events beating qb is confirmed_history", () => {
    expect(resolvePrimarySource({ ...base, qbScore: 1, eventScore: 5 })).toBe("confirmed_history");
  });

  it("qb + ledger both present (ledger < qb) is blended", () => {
    expect(resolvePrimarySource({ ...base, qbScore: 5, ledgerScore: 2 })).toBe("blended");
  });

  it("qb-only is qb_training", () => {
    expect(resolvePrimarySource({ ...base, qbScore: 3 })).toBe("qb_training");
  });

  it("all-zero falls back to confirmed_history", () => {
    expect(resolvePrimarySource(base)).toBe("confirmed_history");
  });
});

describe("resolveConfidence", () => {
  it("top exact-amount hit at >= 2x exact weight is high (independent of score/share)", () => {
    expect(
      resolveConfidence({ score: 0.1, amountScore: 12, amountMatchType: "exact" }, 0, 0.01),
    ).toBe("high");
  });

  it("a nearest (non-exact) amount match does not take the amount high path", () => {
    expect(
      resolveConfidence({ score: 0.1, amountScore: 12, amountMatchType: "nearest" }, 0, 0.01),
    ).toBe("low");
  });

  it("top entry with score>=4 and share>=0.45 is high", () => {
    expect(resolveConfidence({ score: 5, amountScore: 0 }, 0, 0.5)).toBe("high");
  });

  it("score>=2 and share>=0.25 is medium", () => {
    expect(resolveConfidence({ score: 2, amountScore: 0 }, 0, 0.25)).toBe("medium");
  });

  it("weak entry is low", () => {
    expect(resolveConfidence({ score: 1, amountScore: 0 }, 0, 0.5)).toBe("low");
  });

  it("non-top entry can never be high, even with a strong exact amount", () => {
    expect(
      resolveConfidence({ score: 100, amountScore: 12, amountMatchType: "exact" }, 1, 1),
    ).toBe("medium");
  });
});
