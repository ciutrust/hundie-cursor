import { describe, expect, it } from "vitest";
import { calibrateConfidence } from "@/lib/ai/confidence";
import {
  parseModelJson,
  validateGroupResult,
  type VendorGroupClassifyResult,
} from "@/lib/ai/vendor-group-classify";

// Minimal fixtures — validateGroupResult only reads slug/categoryPaths and vendor_key/current_entity.
const charts = [
  { slug: "personal", name: "Personal", categoryPaths: ["Dining & entertainment", "Groceries"] },
] as unknown as Parameters<typeof validateGroupResult>[2];
const pkg = { vendor_key: "vk1", current_entity: "personal" } as unknown as Parameters<
  typeof validateGroupResult
>[1];

function raw(over: Partial<VendorGroupClassifyResult>): VendorGroupClassifyResult {
  return {
    vendor_key: "vk1",
    entity_slug: "personal",
    category_path: null,
    confidence: "high",
    rationale: "because",
    ...over,
  };
}

describe("calibrateConfidence (T5)", () => {
  it("caps one level down and floors anything unknown at low", () => {
    expect(calibrateConfidence("high")).toBe("medium");
    expect(calibrateConfidence("HIGH")).toBe("medium"); // case-insensitive
    expect(calibrateConfidence("medium")).toBe("low");
    expect(calibrateConfidence("low")).toBe("low");
    expect(calibrateConfidence(null)).toBe("low");
    expect(calibrateConfidence(undefined)).toBe("low");
    expect(calibrateConfidence("banana")).toBe("low");
  });
});

describe("parseModelJson (T5)", () => {
  it("parses plain JSON", () => {
    expect(parseModelJson('{"results":[]}')).toEqual({ results: [] });
  });
  it("strips ```json fences", () => {
    const out = parseModelJson('```json\n{"results":[{"vendor_key":"v"}]}\n```');
    expect(out.results?.[0]?.vendor_key).toBe("v");
  });
  it("strips bare ``` fences", () => {
    expect(parseModelJson("```\n{\"results\":[]}\n```")).toEqual({ results: [] });
  });
  it("throws on invalid JSON", () => {
    expect(() => parseModelJson("not json at all")).toThrow();
  });
});

describe("validateGroupResult (T5)", () => {
  it("keeps a valid category_path that exists in the entity's chart", () => {
    const out = validateGroupResult(raw({ category_path: "Groceries" }), pkg, charts);
    expect(out.category_path).toBe("Groceries");
    expect(out.entity_slug).toBe("personal");
  });
  it("nulls a category_path not in the chart (never invent categories)", () => {
    const out = validateGroupResult(raw({ category_path: "Yacht maintenance" }), pkg, charts);
    expect(out.category_path).toBeNull();
  });
  it("falls back to the package's current entity for an unknown entity_slug", () => {
    const out = validateGroupResult(
      raw({ entity_slug: "atlantis", category_path: "Groceries" }),
      pkg,
      charts,
    );
    expect(out.entity_slug).toBe("personal");
    expect(out.category_path).toBe("Groceries"); // re-checked against the fallback entity's chart
  });
  it("calibrates confidence down and truncates the rationale", () => {
    const out = validateGroupResult(
      raw({ confidence: "high", rationale: "x".repeat(500) }),
      pkg,
      charts,
    );
    expect(out.confidence).toBe("medium");
    expect(out.rationale.length).toBe(200);
  });
});
