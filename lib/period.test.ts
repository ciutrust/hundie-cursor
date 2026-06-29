import { afterEach, describe, expect, it, vi } from "vitest";
import { periodRangeFor, ytdPeriod } from "@/lib/period";

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

describe("ytdPeriod (BUG-07)", () => {
  afterEach(() => vi.useRealTimers());

  it("compares the same YTD window in the prior year, not the full prior year", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 28)); // 2026-06-28 (month is 0-based)
    const p = ytdPeriod();
    expect(p.start).toBe("2026-01-01");
    expect(p.end).toBe("2026-06-29");
    expect(p.compareStart).toBe("2025-01-01");
    expect(p.compareEnd).toBe("2025-06-29"); // NOT "2026-01-01"
  });

  it("prior window length equals current window length", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 28));
    const p = ytdPeriod();
    const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;
    expect(days(p.compareStart, p.compareEnd)).toBe(days(p.start, p.end)); // 179 each
  });
});
