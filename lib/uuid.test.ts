import { describe, expect, it } from "vitest";
import { isUuid } from "@/lib/uuid";

describe("isUuid", () => {
  it("accepts a well-formed UUID (any case)", () => {
    expect(isUuid("2f1c9a6e-5b3d-4c8a-9e2f-0a1b2c3d4e5f")).toBe(true);
    expect(isUuid("2F1C9A6E-5B3D-4C8A-9E2F-0A1B2C3D4E5F")).toBe(true);
  });

  it("rejects malformed strings, wrong lengths, and non-hex", () => {
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("2f1c9a6e-5b3d-4c8a-9e2f-0a1b2c3d4e5")).toBe(false); // too short
    expect(isUuid("2f1c9a6e5b3d4c8a9e2f0a1b2c3d4e5f")).toBe(false); // no dashes
    expect(isUuid("zzzzzzzz-5b3d-4c8a-9e2f-0a1b2c3d4e5f")).toBe(false); // non-hex
    expect(isUuid("")).toBe(false);
  });

  it("rejects non-string input", () => {
    expect(isUuid(null)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid(123)).toBe(false);
    expect(isUuid({})).toBe(false);
  });
});
