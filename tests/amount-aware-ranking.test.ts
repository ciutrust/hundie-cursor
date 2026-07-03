import { describe, expect, test } from "vitest";
import {
  rankAmountAwareMatches,
  representativeBulkAmount,
} from "../lib/suggestions/amount-aware-ranking";

const row = (amount: number, id: string, path: string) => ({
  amount,
  category_id: id,
  category: { id, full_path: path },
});

describe("rankAmountAwareMatches", () => {
  test("exact bucket with >=2 occurrences returns an exact match", () => {
    const rows = [row(850, "fr", "Franchise Fees"), row(850, "fr", "Franchise Fees"), row(125, "sw", "Software")];
    const m = rankAmountAwareMatches(850, rows);
    expect(m[0]?.matchType).toBe("exact");
    expect(m[0]?.fullPath).toBe("Franchise Fees");
  });

  test("a single occurrence at the target is below the >=2 threshold -> no match", () => {
    expect(rankAmountAwareMatches(125, [row(125, "sw", "Software")])).toEqual([]);
  });

  test("no exact bucket falls back to the nearest eligible (>=2) bucket", () => {
    const rows = [row(850, "fr", "Franchise Fees"), row(850, "fr", "Franchise Fees")];
    const m = rankAmountAwareMatches(900, rows);
    expect(m[0]?.matchType).toBe("nearest");
    expect(m[0]?.bucketAmount).toBe(850);
  });
});

describe("representativeBulkAmount", () => {
  test("returns the majority amount", () => {
    expect(representativeBulkAmount([20, 20, 20, 35])).toBe(20);
  });
  test("no strict majority -> undefined", () => {
    expect(representativeBulkAmount([10, 20, 30])).toBeUndefined();
  });
  test("keeps the sign of a refund majority (BUG-10)", () => {
    expect(representativeBulkAmount([-50, -50, -50, 35])).toBe(-50);
  });
  test("a charge +50 and a refund -50 do NOT collapse to the same representative", () => {
    // With signed rounding, +50 and -50 are distinct buckets: no strict majority -> undefined.
    expect(representativeBulkAmount([50, 50, -50, -50])).toBeUndefined();
    // A charge majority stays a positive representative.
    expect(representativeBulkAmount([50, 50, 50, -50])).toBe(50);
  });
});

describe("rankAmountAwareMatches sign separation (BUG-10)", () => {
  const rows = [
    row(50, "meals", "Meals"),
    row(50, "meals", "Meals"),
    row(-50, "refund", "Meals Refund"),
    row(-50, "refund", "Meals Refund"),
  ];

  test("a +50 charge target matches only the charge bucket, not the refunds", () => {
    const m = rankAmountAwareMatches(50, rows);
    expect(m).toHaveLength(1);
    expect(m[0]?.matchType).toBe("exact");
    expect(m[0]?.bucketAmount).toBe(50);
    expect(m[0]?.fullPath).toBe("Meals");
  });

  test("a -50 refund target matches the refund bucket", () => {
    const m = rankAmountAwareMatches(-50, rows);
    expect(m[0]?.bucketAmount).toBe(-50);
    expect(m[0]?.fullPath).toBe("Meals Refund");
  });
});
