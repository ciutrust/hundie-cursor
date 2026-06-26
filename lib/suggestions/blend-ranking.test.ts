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
});
