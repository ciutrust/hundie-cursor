import { describe, expect, it } from "vitest";
import { periodRangeFor } from "@/lib/period";

describe("periodRangeFor", () => {
  it("parses month periods", () => {
    const range = periodRangeFor("month", "2026-06");
    expect(range.start).toBe("2026-06-01");
    expect(range.end).toBe("2026-07-01");
  });

  it("falls back to current month for invalid at", () => {
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const range = periodRangeFor("month", "not-a-period");
    expect(range.at).toBe(expected);
  });
});
