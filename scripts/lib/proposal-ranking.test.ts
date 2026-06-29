import { describe, it, expect } from "vitest";
import { dominantCategory, trainingRationale } from "./proposal-ranking.mjs";

const C = (categoryId: string, count: number) => ({ categoryId, categoryPath: categoryId, count });

describe("dominantCategory", () => {
  it("unanimous, many samples → high", () => {
    expect(dominantCategory([C("ads", 9)])?.confidence).toBe("high");
  });

  it("strong majority with ≥3 samples → high", () => {
    const r = dominantCategory([C("ads", 8), C("software", 1)]);
    expect(r?.confidence).toBe("high");
    expect(r?.categoryId).toBe("ads");
  });

  it("single prior example → medium (share 1.0 but <3 samples)", () => {
    expect(dominantCategory([C("ads", 1)])?.confidence).toBe("medium");
  });

  it("2 of 3 (≥0.6, <0.8) → medium", () => {
    expect(dominantCategory([C("ads", 2), C("software", 1)])?.confidence).toBe("medium");
  });

  it("evenly split → null (leave for Tier 2)", () => {
    expect(dominantCategory([C("ads", 1), C("software", 1)])).toBeNull();
  });

  it("3-way tie → null", () => {
    expect(dominantCategory([C("a", 1), C("b", 1), C("c", 1)])).toBeNull();
  });

  it("empty / no signal → null", () => {
    expect(dominantCategory([])).toBeNull();
    expect(dominantCategory([C("a", 0)])).toBeNull();
  });

  it("picks the top category, not first listed", () => {
    expect(dominantCategory([C("low", 1), C("high", 9)])?.categoryId).toBe("high");
  });

  it("rationale reads as a fraction + percent", () => {
    const r = dominantCategory([C("ads", 8), C("x", 2)]);
    expect(trainingRationale(r, "google ads")).toBe('8/10 prior "google ads" → ads (80%)');
  });
});
