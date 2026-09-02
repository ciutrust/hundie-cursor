import { describe, expect, it } from "vitest";
import {
  addDaysIso,
  dateAmountKeys,
  matchScore,
  normalizeText,
  pickBestMatch,
  significantWords,
  stripQboCardSuffix,
} from "./qb-match.mjs";

// Locks in the scoring contract shared by scripts/apply-qb-categories-to-ledger.mjs and the
// QBO drift report. Any change here changes which ledger rows get auto-categorized.

const card = (over = {}) => ({
  transaction_date: "2026-05-10",
  amount: -42.5,
  vendor: "Alpha",
  description: "",
  ...over,
});

const qb = (over = {}) => ({
  transaction_date: "2026-05-10",
  amount: 42.5,
  vendor_name: "Zulu",
  description: "",
  ...over,
});

describe("normalizeText", () => {
  it("lowercases, strips punctuation, and collapses whitespace", () => {
    expect(normalizeText("  SQ *Blue-Bottle,   COFFEE!! ")).toBe("sq blue bottle coffee");
  });

  it("treats null/undefined as empty", () => {
    expect(normalizeText(null)).toBe("");
    expect(normalizeText(undefined)).toBe("");
  });
});

describe("significantWords", () => {
  it("drops stop words and words shorter than 3 chars", () => {
    expect(significantWords("Payment to the Amazon Inc LLC at 12")).toEqual(["amazon"]);
  });

  it("keeps real vendor words", () => {
    expect(significantWords("Home Depot 4521")).toEqual(["home", "depot", "4521"]);
  });
});

describe("stripQboCardSuffix", () => {
  it("removes a trailing ' - 6754' card marker", () => {
    expect(stripQboCardSuffix("Amazon Prime - 6754")).toBe("Amazon Prime");
    expect(stripQboCardSuffix("Amazon Prime -6754  ")).toBe("Amazon Prime");
  });

  it("leaves non-suffix digits alone", () => {
    expect(stripQboCardSuffix("Amazon Prime 6754")).toBe("Amazon Prime 6754");
    expect(stripQboCardSuffix("Store - 67540")).toBe("Store - 67540");
    expect(stripQboCardSuffix(null)).toBe("");
  });
});

describe("addDaysIso", () => {
  it("crosses month and year boundaries in both directions", () => {
    expect(addDaysIso("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDaysIso("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDaysIso("2025-12-31", 1)).toBe("2026-01-01");
    expect(addDaysIso("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("handles leap day", () => {
    expect(addDaysIso("2024-02-28", 1)).toBe("2024-02-29");
  });
});

describe("dateAmountKeys", () => {
  it("returns a single key with slack 0, using the absolute 2dp amount", () => {
    expect(dateAmountKeys({ transaction_date: "2026-05-10", amount: -12.5 })).toEqual(["2026-05-10|12.50"]);
    expect(dateAmountKeys({ transaction_date: "2026-05-10", amount: "12.5" }, 0)).toEqual(["2026-05-10|12.50"]);
  });

  it("returns 2n+1 keys with slack n, fanning out +/- each day", () => {
    const keys = dateAmountKeys({ transaction_date: "2026-05-10", amount: 12.5 }, 2);
    expect(keys).toHaveLength(5);
    expect(keys).toEqual([
      "2026-05-10|12.50",
      "2026-05-11|12.50",
      "2026-05-09|12.50",
      "2026-05-12|12.50",
      "2026-05-08|12.50",
    ]);
  });
});

describe("matchScore", () => {
  it("returns 0 on amount mismatch", () => {
    expect(matchScore(card({ amount: 10 }), qb({ amount: 10.01 }))).toBe(0);
  });

  it("compares absolute amounts (sign is ignored)", () => {
    expect(matchScore(card({ amount: -10 }), qb({ amount: 10 }))).toBe(10);
    expect(matchScore(card({ amount: "10.00" }), qb({ amount: -10 }))).toBe(10);
  });

  it("scores 10 for exact date + amount with no word overlap", () => {
    expect(matchScore(card(), qb())).toBe(10);
  });

  it("scores 8 base when the date differs but is within slack", () => {
    expect(matchScore(card(), qb({ transaction_date: "2026-05-12" }), 5)).toBe(8);
    expect(matchScore(card(), qb({ transaction_date: "2026-05-05" }), 5)).toBe(8);
  });

  it("returns 0 when the date differs beyond slack", () => {
    expect(matchScore(card(), qb({ transaction_date: "2026-05-12" }), 1)).toBe(0);
    expect(matchScore(card(), qb({ transaction_date: "2026-05-11" }))).toBe(0);
  });

  it("adds 4 per shared significant word (no prefix overlap)", () => {
    // Chosen so neither text contains the other's first 10 chars.
    expect(matchScore(card({ vendor: "Zulu Amazon" }), qb({ vendor_name: "Amazon Bravo" }))).toBe(14);
    expect(matchScore(card({ vendor: "Zulu Prime Amazon" }), qb({ vendor_name: "Amazon Bravo Prime" }))).toBe(18);
  });

  it("ignores the QBO card suffix when comparing words", () => {
    expect(matchScore(card({ vendor: "Zulu Amazon" }), qb({ vendor_name: "Amazon Bravo - 6754" }))).toBe(14);
  });

  it("adds 3 for a 10-char prefix overlap without shared words", () => {
    // Vendors blanked so the description is the whole text and the prefix check can fire.
    expect(
      matchScore(
        card({ vendor: "", description: "ACHTRANSFER0001" }),
        qb({ vendor_name: "", description: "ACHTRANSFER0001XYZ" }),
      ),
    ).toBe(13);
  });

  it("stacks word and prefix bonuses", () => {
    // "amazon prime" both sides: 2 words (+8) and prefix overlap (+3).
    expect(matchScore(card({ vendor: "Amazon Prime" }), qb({ vendor_name: "Amazon Prime - 6754" }))).toBe(21);
  });
});

describe("pickBestMatch", () => {
  const cands = (...rows) => rows.map((row, index) => ({ qb: row, index }));

  it("returns null when there are no scoring candidates", () => {
    expect(pickBestMatch(card(), [])).toBeNull();
    expect(pickBestMatch(card(), cands(qb({ amount: 1 })))).toBeNull();
  });

  it("returns null on a tie for the top score", () => {
    const result = pickBestMatch(card({ vendor: "Alpha" }), cands(qb({ vendor_name: "Alpha" }), qb({ vendor_name: "Alpha" })));
    expect(result).toBeNull();
  });

  it("single candidate, exact date: floor 10 (date+amount alone is enough)", () => {
    const result = pickBestMatch(card(), cands(qb()));
    expect(result).toEqual({ qb: qb(), index: 0, score: 10 });
  });

  it("single candidate, date differs: floor 12 (needs one vendor word)", () => {
    expect(pickBestMatch(card(), cands(qb({ transaction_date: "2026-05-11" })), 5)).toBeNull();
    const result = pickBestMatch(
      card({ vendor: "Zulu Amazon" }),
      cands(qb({ vendor_name: "Amazon Bravo", transaction_date: "2026-05-11" })),
      5,
    );
    expect(result?.score).toBe(12);
    expect(result?.index).toBe(0);
  });

  it("multiple candidates, exact date: floor 13", () => {
    // Best is 10 (not tied: the other is 8), but 10 < 13 with multiple candidates.
    expect(
      pickBestMatch(card(), cands(qb(), qb({ vendor_name: "Yankee", transaction_date: "2026-05-11" })), 5),
    ).toBeNull();
    const result = pickBestMatch(
      card({ vendor: "Zulu Amazon" }),
      cands(qb({ vendor_name: "Amazon Bravo" }), qb({ vendor_name: "Charlie" })),
    );
    expect(result?.score).toBe(14);
    expect(result?.index).toBe(0);
  });

  it("multiple candidates, date differs: floor 15", () => {
    expect(
      pickBestMatch(
        card({ vendor: "Zulu Amazon" }),
        cands(
          qb({ vendor_name: "Amazon Bravo", transaction_date: "2026-05-11" }),
          qb({ vendor_name: "Charlie", transaction_date: "2026-05-12" }),
        ),
        5,
      ),
    ).toBeNull();
    const result = pickBestMatch(
      card({ vendor: "Zulu Prime Amazon" }),
      cands(
        qb({ vendor_name: "Amazon Bravo Prime", transaction_date: "2026-05-11" }),
        qb({ vendor_name: "Charlie", transaction_date: "2026-05-12" }),
      ),
      5,
    );
    expect(result?.score).toBe(16);
    expect(result?.index).toBe(0);
  });

  it("preserves the candidate's original index", () => {
    const result = pickBestMatch(
      card({ vendor: "Zulu Amazon" }),
      cands(qb({ vendor_name: "Charlie" }), qb({ vendor_name: "Amazon Bravo" })),
    );
    expect(result?.index).toBe(1);
  });
});
