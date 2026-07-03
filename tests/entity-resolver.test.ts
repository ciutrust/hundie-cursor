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

describe("resolveEntitySlug — both-bounded rule (C17)", () => {
  const bothBounded = {
    default_entity: { slug: "personal" },
    date_rules: [{ from: "2026-01-01", until: "2026-06-30", entity_slug: "gbsl" }],
  };

  it("falls back to default BEFORE the window (the until-alone bug is gone)", () => {
    // 2025-12-01 is <= until but < from — the old code returned gbsl on the until check alone.
    expect(resolveEntitySlug(bothBounded, "2025-12-01")).toBe("personal");
  });

  it("matches inside the window", () => {
    expect(resolveEntitySlug(bothBounded, "2026-03-01")).toBe("gbsl");
    expect(resolveEntitySlug(bothBounded, "2026-01-01")).toBe("gbsl");
    expect(resolveEntitySlug(bothBounded, "2026-06-30")).toBe("gbsl");
  });

  it("falls back to default AFTER the window", () => {
    expect(resolveEntitySlug(bothBounded, "2026-09-01")).toBe("personal");
  });
});
