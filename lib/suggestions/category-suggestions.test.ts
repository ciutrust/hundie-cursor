import { describe, expect, it } from "vitest";
import {
  computeSuggestionConfidence,
  extractSearchTokens,
  extractVendorSearchKey,
  rankCategorySuggestions,
  sanitizeOrToken,
} from "@/lib/suggestions/category-suggestions";

// QA-09: pin the highest-value pure suggestion helpers. No Supabase mock — these are the
// functions that decide what a vendor's pill suggests and (sanitizeOrToken) guard the .or()
// PostgREST injection surface, so locking their current behavior protects the whole pipeline.

describe("sanitizeOrToken (.or() injection guard)", () => {
  it("strips PostgREST-significant chars (% _ \\ ( ) , .) but keeps spaces, *, -, '", () => {
    expect(sanitizeOrToken("home%depot")).toBe("homedepot");
    expect(sanitizeOrToken("a,b.c(d)")).toBe("abcd");
    expect(sanitizeOrToken("under_score")).toBe("underscore");
    expect(sanitizeOrToken("back\\slash")).toBe("backslash");
    expect(sanitizeOrToken("safe text")).toBe("safe text");
    expect(sanitizeOrToken("100%_off,now.")).toBe("100offnow");
    expect(sanitizeOrToken("o'reilly-co")).toBe("o'reilly-co");
  });
});

describe("extractVendorSearchKey", () => {
  it("prefers the vendor string and lowercases it", () => {
    expect(extractVendorSearchKey("", "Starbucks")).toBe("starbucks");
  });

  it("pops a trailing TAIL_STOP_WORD (state/tld code)", () => {
    expect(extractVendorSearchKey("", "AMAZON MKTPLACE US")).toBe("amazon mktplace");
  });

  it("turns punctuation into word boundaries", () => {
    expect(extractVendorSearchKey("", "SQ *COFFEE SHOP")).toBe("sq coffee shop");
  });

  it("strips a 4+ digit ref run and keeps the first 3 words", () => {
    expect(extractVendorSearchKey("", "PAYPAL *UBER 4029357733")).toBe("paypal uber");
  });

  it("strips an email domain", () => {
    expect(extractVendorSearchKey("", "billing@netflix.com")).toBe("billing");
  });

  it("falls back to extractVendor(description) when vendor is null", () => {
    expect(extractVendorSearchKey("WHOLEFDS MKT 4521", null)).toBe("wholefds mkt");
  });

  it("does NOT strip a 3-digit run (pins the 4+ boundary)", () => {
    expect(extractVendorSearchKey("WHOLEFDS MKT 123", null)).toBe("wholefds mkt 123");
  });
});

describe("extractSearchTokens", () => {
  it("emits the vendor key token plus a useful description word", () => {
    expect(extractSearchTokens("STARBUCKS STORE 1234", "Starbucks")).toEqual([
      "starbucks",
      "store",
    ]);
  });

  it("keeps a generic word inside a multi-word phrase", () => {
    // 'google' alone is generic and 'ads' is too short, but the phrase survives.
    expect(extractSearchTokens("GOOGLE ADS", "GOOGLE ADS")).toEqual(["google ads"]);
  });

  it("returns [] when every candidate is generic/short/stop (drives shouldSuggest=false)", () => {
    expect(extractSearchTokens("GOOGLE ADS PAYMENT", "GOOGLE")).toEqual([]);
  });
});

describe("computeSuggestionConfidence", () => {
  it("rank 0: high needs count>=5 and share>=0.55", () => {
    expect(computeSuggestionConfidence(5, 9, 0)).toBe("high");
    expect(computeSuggestionConfidence(5, 10, 0)).toBe("medium"); // share 0.5 < 0.55
    expect(computeSuggestionConfidence(4, 5, 0)).toBe("medium");
    expect(computeSuggestionConfidence(2, 5, 0)).toBe("medium");
    expect(computeSuggestionConfidence(1, 5, 0)).toBe("low");
    expect(computeSuggestionConfidence(10, 0, 0)).toBe("high"); // total clamps to 1
  });

  it("rank > 0: at most medium, needs count>=3 and share>=0.4", () => {
    expect(computeSuggestionConfidence(3, 5, 1)).toBe("medium");
    expect(computeSuggestionConfidence(3, 10, 1)).toBe("low"); // 0.3 < 0.4
    expect(computeSuggestionConfidence(2, 3, 1)).toBe("low"); // count < 3
    expect(computeSuggestionConfidence(5, 9, 2)).toBe("medium");
  });
});

describe("rankCategorySuggestions", () => {
  const rows = [
    ...Array(5).fill({ category_id: "a", category_name: "Expenses:Software" }),
    ...Array(2).fill({ category_id: "b", category_name: "Expenses:Meals" }),
    { category_id: null, category_name: "" },
  ];

  it("counts by id, skips null, ranks by count, defaults source to qb_training", () => {
    const result = rankCategorySuggestions(rows);
    expect(result).toEqual([
      {
        categoryId: "a",
        fullPath: "Expenses:Software",
        count: 5,
        source: "qb_training",
        confidence: "high", // 5/7 = 0.714 >= 0.55
      },
      {
        categoryId: "b",
        fullPath: "Expenses:Meals",
        count: 2,
        source: "qb_training",
        confidence: "low", // rank > 0, count < 3
      },
    ]);
  });

  it("threads the source argument through", () => {
    const result = rankCategorySuggestions(rows, "confirmed_history");
    expect(result.map((r) => r.source)).toEqual(["confirmed_history", "confirmed_history"]);
  });

  it("breaks count ties by first-seen (stable) order", () => {
    const tied = [
      { category_id: "a", category_name: "A" },
      { category_id: "b", category_name: "B" },
      { category_id: "a", category_name: "A" },
      { category_id: "b", category_name: "B" },
    ];
    const result = rankCategorySuggestions(tied);
    expect(result.map((r) => r.categoryId)).toEqual(["a", "b"]);
    expect(result[0].confidence).toBe("medium"); // index 0, count 2, share 0.5
    expect(result[1].confidence).toBe("low"); // index 1
  });

  it("caps at the top 3 categories", () => {
    const four = [
      { category_id: "id1", category_name: "1" },
      { category_id: "id2", category_name: "2" },
      { category_id: "id3", category_name: "3" },
      { category_id: "id4", category_name: "4" },
    ];
    const result = rankCategorySuggestions(four);
    expect(result.map((r) => r.categoryId)).toEqual(["id1", "id2", "id3"]);
  });
});
