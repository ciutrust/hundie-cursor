import { describe, expect, it } from "vitest";
import { resolveEntitySlug } from "../scripts/lib/entity-resolver.mjs";

const quicksilverRules = {
  default_entity: { slug: "personal" },
  date_rules: [
    { until: "2025-06-30", entity_slug: "gbsl" },
    { from: "2025-07-01", entity_slug: "personal" },
  ],
};

describe("resolveEntitySlug", () => {
  it("assigns gbsl before switch date", () => {
    expect(resolveEntitySlug(quicksilverRules, "2025-06-30")).toBe("gbsl");
  });

  it("assigns personal on and after switch date", () => {
    expect(resolveEntitySlug(quicksilverRules, "2025-07-01")).toBe("personal");
    expect(resolveEntitySlug(quicksilverRules, "2026-03-15")).toBe("personal");
  });
});
