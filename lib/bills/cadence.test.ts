import { describe, expect, it } from "vitest";
import {
  addCadence,
  cadenceMonths,
  daysBetween,
  dueDateInMonth,
  mostRecentWeekday,
  parseIsoDate,
} from "@/lib/bills/cadence";

describe("cadenceMonths", () => {
  it("maps month-anchored cadences and returns null for weekly/one_time", () => {
    expect(cadenceMonths("monthly")).toBe(1);
    expect(cadenceMonths("quarterly")).toBe(3);
    expect(cadenceMonths("semiannual")).toBe(6);
    expect(cadenceMonths("annual")).toBe(12);
    expect(cadenceMonths("weekly")).toBeNull();
    expect(cadenceMonths("one_time")).toBeNull();
  });
});

describe("addCadence", () => {
  it("advances weekly by 7 days across a month boundary", () => {
    expect(addCadence("2026-01-28", "weekly")).toBe("2026-02-04");
  });

  it("advances month-anchored cadences by the right number of months", () => {
    expect(addCadence("2026-01-15", "monthly")).toBe("2026-02-15");
    expect(addCadence("2026-01-15", "quarterly")).toBe("2026-04-15");
    expect(addCadence("2026-01-15", "semiannual")).toBe("2026-07-15");
    expect(addCadence("2026-01-15", "annual")).toBe("2027-01-15");
  });

  it("clamps the day-of-month to the target month's length", () => {
    expect(addCadence("2026-01-31", "monthly")).toBe("2026-02-28"); // 2026 not a leap year
    expect(addCadence("2024-01-31", "monthly")).toBe("2024-02-29"); // leap year
    expect(addCadence("2026-03-31", "monthly")).toBe("2026-04-30");
  });

  it("returns the same date for one_time", () => {
    expect(addCadence("2026-05-01", "one_time")).toBe("2026-05-01");
  });
});

describe("dueDateInMonth", () => {
  it("clamps out-of-range days into the month", () => {
    expect(dueDateInMonth(2026, 1, 31)).toBe("2026-02-28"); // Feb
    expect(dueDateInMonth(2026, 0, 15)).toBe("2026-01-15");
    expect(dueDateInMonth(2026, 6, 0)).toBe("2026-07-01"); // floor at day 1
  });
});

describe("daysBetween", () => {
  it("returns whole-day signed differences", () => {
    expect(daysBetween("2026-07-15", "2026-07-10")).toBe(5);
    expect(daysBetween("2026-07-10", "2026-07-15")).toBe(-5);
    expect(daysBetween("2026-07-10", "2026-07-10")).toBe(0);
    expect(daysBetween("2026-08-01", "2026-07-01")).toBe(31);
  });
});

describe("mostRecentWeekday", () => {
  it("returns a date on-or-before the reference with the requested weekday", () => {
    for (const weekday of [0, 1, 2, 3, 4, 5, 6]) {
      const result = mostRecentWeekday("2026-07-15", weekday);
      expect(result <= "2026-07-15").toBe(true);
      expect(parseIsoDate(result).getDay()).toBe(weekday);
      expect(daysBetween("2026-07-15", result)).toBeGreaterThanOrEqual(0);
      expect(daysBetween("2026-07-15", result)).toBeLessThanOrEqual(6);
    }
  });
});
