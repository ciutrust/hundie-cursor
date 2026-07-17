import { describe, expect, it } from "vitest";
import {
  defaultDateRange,
  formatExpenseReportNumber,
  isIsoDate,
  nextDay,
  parseDateRange,
  startOfMonth,
} from "./date-range";

describe("isIsoDate", () => {
  it("accepts a real ISO day", () => {
    expect(isIsoDate("2026-03-12")).toBe(true);
  });

  it("rejects malformed or impossible values", () => {
    for (const bad of ["2026-3-12", "03/12/2026", "2026-13-01", "", null, undefined, 20260312]) {
      expect(isIsoDate(bad)).toBe(false);
    }
  });
});

describe("nextDay", () => {
  it("advances one day", () => {
    expect(nextDay("2026-03-12")).toBe("2026-03-13");
  });

  it("rolls over a month boundary", () => {
    expect(nextDay("2026-03-31")).toBe("2026-04-01");
  });

  it("rolls over a year boundary", () => {
    expect(nextDay("2025-12-31")).toBe("2026-01-01");
  });

  it("handles a leap day", () => {
    expect(nextDay("2028-02-28")).toBe("2028-02-29");
    expect(nextDay("2028-02-29")).toBe("2028-03-01");
  });
});

describe("startOfMonth", () => {
  it("returns the first of the month", () => {
    expect(startOfMonth("2026-07-05")).toBe("2026-07-01");
  });
});

describe("parseDateRange", () => {
  const today = "2026-07-05";

  it("uses an explicit from/to and makes end exclusive", () => {
    const range = parseDateRange({ from: "2026-03-12", to: "2026-03-19" }, today);
    expect(range.from).toBe("2026-03-12");
    expect(range.to).toBe("2026-03-19");
    expect(range.start).toBe("2026-03-12");
    // end is exclusive so the 19th itself is included by .gte(start).lt(end)
    expect(range.end).toBe("2026-03-20");
  });

  it("swaps a backwards window instead of returning nothing", () => {
    const range = parseDateRange({ from: "2026-03-19", to: "2026-03-12" }, today);
    expect(range.from).toBe("2026-03-12");
    expect(range.to).toBe("2026-03-19");
    expect(range.end).toBe("2026-03-20");
  });

  it("falls back to the current month when both sides are missing", () => {
    const range = parseDateRange({}, today);
    expect(range.from).toBe("2026-07-01");
    expect(range.to).toBe("2026-07-05");
    expect(range.end).toBe("2026-07-06");
  });

  it("falls back to the current month when a side is malformed", () => {
    const range = parseDateRange({ from: "03/12/2026", to: "nope" }, today);
    expect(range).toEqual(defaultDateRange(today));
  });

  it("fills a missing `to` with today", () => {
    const range = parseDateRange({ from: "2026-06-01" }, today);
    expect(range.from).toBe("2026-06-01");
    expect(range.to).toBe(today);
  });

  it("fills a missing `from` with the start of the to-month", () => {
    const range = parseDateRange({ to: "2026-05-20" }, today);
    expect(range.from).toBe("2026-05-01");
    expect(range.to).toBe("2026-05-20");
  });

  it("supports a single-day window", () => {
    const range = parseDateRange({ from: "2026-03-12", to: "2026-03-12" }, today);
    expect(range.start).toBe("2026-03-12");
    expect(range.end).toBe("2026-03-13");
  });
});

describe("formatExpenseReportNumber", () => {
  it("zero-pads to four digits", () => {
    expect(formatExpenseReportNumber(1)).toBe("0001");
    expect(formatExpenseReportNumber(42)).toBe("0042");
    expect(formatExpenseReportNumber(1234)).toBe("1234");
  });

  it("does not truncate past four digits", () => {
    expect(formatExpenseReportNumber(12345)).toBe("12345");
  });
});
