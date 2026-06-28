import { describe, expect, test } from "vitest";
import {
  decideStepUp,
  isSameOrigin,
  pathRequiresStepUp,
  type AalResult,
} from "./require-mfa";

describe("decideStepUp — SEC-01 fail-closed step-up matrix", () => {
  test("aal2 session → allow (the only allow case)", () => {
    const aal: AalResult = {
      data: { currentLevel: "aal2", nextLevel: "aal2" },
      error: null,
    };
    expect(decideStepUp(aal)).toBe("allow");
  });

  test("aal1 with a verified factor (next aal2) → step-up (deny, challenge)", () => {
    const aal: AalResult = {
      data: { currentLevel: "aal1", nextLevel: "aal2" },
      error: null,
    };
    expect(decideStepUp(aal)).toBe("step-up");
  });

  test("no factor enrolled (aal1/aal1) → enroll (deny)", () => {
    const aal: AalResult = {
      data: { currentLevel: "aal1", nextLevel: "aal1" },
      error: null,
    };
    expect(decideStepUp(aal)).toBe("enroll");
  });

  test("AAL lookup error → enroll (deny, fail closed)", () => {
    const aal: AalResult = { data: null, error: new Error("network") };
    expect(decideStepUp(aal)).toBe("enroll");
  });

  test("null data with no error → enroll (deny, fail closed)", () => {
    const aal: AalResult = { data: null, error: null };
    expect(decideStepUp(aal)).toBe("enroll");
  });

  test("unknown/null levels → enroll (deny, fail closed)", () => {
    const aal: AalResult = {
      data: { currentLevel: null, nextLevel: null },
      error: null,
    };
    expect(decideStepUp(aal)).toBe("enroll");
  });
});

describe("pathRequiresStepUp — only the bank-token surface is gated", () => {
  test.each([
    ["/settings/connections", true],
    ["/settings/connections/", true],
    ["/settings/connections/plaid", true],
  ])("gates %s", (path, expected) => {
    expect(pathRequiresStepUp(path)).toBe(expected);
  });

  test.each([
    ["/settings/security", false], // enrollment must stay reachable at aal1
    ["/settings", false],
    ["/settings/connections-archive", false], // prefix must be path-segment exact
    ["/login", false], // never gated
    ["/mfa", false], // never gated
    ["/review", false],
  ])("does NOT gate %s", (path, expected) => {
    expect(pathRequiresStepUp(path)).toBe(expected);
  });
});

describe("isSameOrigin — SEC-06 CSRF/same-origin guard", () => {
  test("matching https origin/host → true", () => {
    expect(isSameOrigin("https://app.hundie.com", "app.hundie.com")).toBe(true);
  });

  test("matching dev origin/host with port → true", () => {
    expect(isSameOrigin("http://localhost:3000", "localhost:3000")).toBe(true);
  });

  test("cross-site origin → false", () => {
    expect(isSameOrigin("https://evil.com", "app.hundie.com")).toBe(false);
  });

  test("missing origin → false (fail closed)", () => {
    expect(isSameOrigin(null, "app.hundie.com")).toBe(false);
  });

  test("missing host → false (fail closed)", () => {
    expect(isSameOrigin("https://app.hundie.com", null)).toBe(false);
  });

  test("malformed origin → false", () => {
    expect(isSameOrigin("not-a-url", "app.hundie.com")).toBe(false);
  });
});
