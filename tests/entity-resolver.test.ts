import { describe, expect, it } from "vitest";
import { resolveEntitySlug } from "../scripts/lib/entity-resolver.mjs";

const quicksilverRules = {
  default_entity: { slug: "personal" },
  date_rules: [
    { until: "2026-06-30", entity_slug: "gbsl" },
    { from: "2026-07-01", entity_slug: "personal" },
  ],
};

describe("resolveEntitySlug — Quicksilver", () => {
  it("assigns gbsl through June 2026", () => {
    expect(resolveEntitySlug(quicksilverRules, "2025-12-15")).toBe("gbsl");
    expect(resolveEntitySlug(quicksilverRules, "2026-06-30")).toBe("gbsl");
  });

  it("assigns personal from July 2026", () => {
    expect(resolveEntitySlug(quicksilverRules, "2026-07-01")).toBe("personal");
    expect(resolveEntitySlug(quicksilverRules, "2026-09-01")).toBe("personal");
  });
});
