import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALL_TIME_START,
  allTimePeriod,
  parsePeriodParams,
  periodQueryString,
  periodRangeFor,
  shiftPeriod,
  ytdPeriod,
} from "@/lib/period";

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

describe("allTimePeriod", () => {
  afterEach(() => vi.useRealTimers());

  it("spans 1970 through tomorrow with a ZERO-WIDTH compare window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 31)); // 2026-08-31
    const p = allTimePeriod();
    expect(p.type).toBe("all");
    expect(p.start).toBe(ALL_TIME_START);
    expect(p.end).toBe("2026-09-01"); // tomorrow, end-exclusive → today included
    expect(p.at).toBe("all");
    expect(p.label).toBe("All time");
    // Zero-width compare: any compare fetch returns nothing, so trend badges self-hide.
    expect(p.compareStart).toBe(p.compareEnd);
  });

  it("periodRangeFor('all') ignores `at` and never falls back to current month", () => {
    const p = periodRangeFor("all", "garbage");
    expect(p.type).toBe("all");
    expect(p.start).toBe(ALL_TIME_START);
  });

  it("shiftPeriod is a no-op for 'all' (no previous/next range)", () => {
    const p = allTimePeriod();
    expect(shiftPeriod(p, -1)).toBe(p);
    expect(shiftPeriod(p, 1)).toBe(p);
  });

  it("round-trips through URL params", () => {
    const p = allTimePeriod();
    const qs = new URLSearchParams(periodQueryString(p));
    expect(qs.get("period")).toBe("all");
    const reparsed = parsePeriodParams({ period: qs.get("period") ?? undefined, at: qs.get("at") ?? undefined });
    expect(reparsed.type).toBe("all");
    expect(reparsed.start).toBe(ALL_TIME_START);
  });

  it("is only the default — explicit legacy ?month= params still win", () => {
    const p = parsePeriodParams({ month: "2026-05" }, allTimePeriod());
    expect(p.type).toBe("month");
    expect(p.start).toBe("2026-05-01");
  });

  it("no explicit params returns the passed all-time default", () => {
    const p = parsePeriodParams({}, allTimePeriod());
    expect(p.type).toBe("all");
  });
});
