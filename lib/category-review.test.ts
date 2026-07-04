import { describe, expect, it } from "vitest";
import {
  getCpaReviewCategoryIdSet,
  isCpaReviewCategory,
  needsCategoryReview,
  needsReviewCategory,
  reviewBacklogOrClause,
} from "@/lib/category-review";

describe("needsCategoryReview (path-based, OPT-07)", () => {
  it("treats null/blank/undefined as review (uncategorized)", () => {
    expect(needsCategoryReview(null)).toBe(true);
    expect(needsCategoryReview("")).toBe(true);
    expect(needsCategoryReview(undefined)).toBe(true);
  });

  it("treats AMA as review and real categories as not", () => {
    expect(needsCategoryReview("Ask My Accountant")).toBe(true);
    expect(needsCategoryReview("Software")).toBe(false);
  });
});

describe("isCpaReviewCategory (OPT-07)", () => {
  it("matches only the AMA path", () => {
    expect(isCpaReviewCategory("Ask My Accountant")).toBe(true);
    expect(isCpaReviewCategory("Software")).toBe(false);
    expect(isCpaReviewCategory(null)).toBe(false);
  });
});

describe("needsReviewCategory (id-based, OPT-07)", () => {
  it("treats null id as review", () => {
    expect(needsReviewCategory(null, new Set())).toBe(true);
  });

  it("treats an AMA id as review and a real id as not", () => {
    expect(needsReviewCategory("ama-id", new Set(["ama-id"]))).toBe(true);
    expect(needsReviewCategory("real-id", new Set(["ama-id"]))).toBe(false);
  });
});

describe("getCpaReviewCategoryIdSet (OPT-07)", () => {
  it("returns the set of AMA category ids from the query", async () => {
    const stub = {
      from: () => ({
        select: () => ({
          in: async () => ({ data: [{ id: "ama-id" }] }),
        }),
      }),
    } as any;
    expect(await getCpaReviewCategoryIdSet(stub)).toEqual(new Set(["ama-id"]));
  });

  it("B4: throws on a query error instead of silently returning an empty set", async () => {
    const stub = {
      from: () => ({
        select: () => ({
          in: async () => ({ data: null, error: { message: "boom" } }),
        }),
      }),
    } as any;
    await expect(getCpaReviewCategoryIdSet(stub)).rejects.toThrow(/boom/);
  });
});

describe("reviewBacklogOrClause (BUG-14/OPT-06)", () => {
  it("matches uncategorized only when there are no CPA-review ids", () => {
    expect(reviewBacklogOrClause([])).toBe("classification.category_id.is.null");
  });

  it("matches uncategorized OR any CPA-review category id", () => {
    expect(reviewBacklogOrClause(["a", "b"])).toBe(
      "classification.category_id.is.null,classification.category_id.in.(a,b)",
    );
  });
});
