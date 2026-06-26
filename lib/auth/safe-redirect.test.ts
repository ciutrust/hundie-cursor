import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "@/lib/auth/safe-redirect";

describe("safeRedirectPath", () => {
  it("allows relative paths", () => {
    expect(safeRedirectPath("/reports")).toBe("/reports");
    expect(safeRedirectPath("/review/gbsl")).toBe("/review/gbsl");
  });

  it("rejects open redirects", () => {
    expect(safeRedirectPath("//evil.com")).toBe("/review");
    expect(safeRedirectPath("https://evil.com")).toBe("/review");
    expect(safeRedirectPath(null)).toBe("/review");
  });
});
