import { describe, expect, it } from "vitest";
import { mergeWeightedSuggestions, recencyWeight } from "@/lib/suggestions/blend-ranking";

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
