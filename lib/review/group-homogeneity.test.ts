import { describe, expect, it } from "vitest";
import { groupIsHomogeneous } from "@/lib/review/group-homogeneity";

const p = (proposed_category_id: string | null) => ({ proposed_category_id });

describe("groupIsHomogeneous", () => {
  it("is true when every row shares the same proposed category", () => {
    expect(groupIsHomogeneous([p("c1"), p("c1"), p("c1")])).toBe(true);
  });
  it("is false when rows have different proposed categories", () => {
    expect(groupIsHomogeneous([p("c1"), p("c2")])).toBe(false);
  });
  it("is true for a single row", () => {
    expect(groupIsHomogeneous([p("c1")])).toBe(true);
  });
  it("is true for an empty group (nothing to conflict)", () => {
    expect(groupIsHomogeneous([])).toBe(true);
  });
  it("treats null as a distinct category value (null vs a real id is heterogeneous)", () => {
    expect(groupIsHomogeneous([p(null), p("c1")])).toBe(false);
    expect(groupIsHomogeneous([p(null), p(null)])).toBe(true);
  });
});
