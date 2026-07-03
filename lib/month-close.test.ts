import { describe, expect, test } from "vitest";
import { cellStatus, rollupStatus, summarizeMonths } from "./month-close";

describe("cellStatus", () => {
  test("no activity -> empty", () =>
    expect(cellStatus({ hasActivity: false, backlogCount: 0, orphanCount: 0 })).toBe("empty"));
  test("activity, zero backlog -> closed (CPA-ready)", () =>
    expect(cellStatus({ hasActivity: true, backlogCount: 0, orphanCount: 0 })).toBe("closed"));
  test("activity with backlog (unclassified or AMA) -> open", () =>
    expect(cellStatus({ hasActivity: true, backlogCount: 3, orphanCount: 0 })).toBe("open"));

  // C9: an orphan (a transactions row with no classifications row) is an unbooked charge. It must
  // keep the month OPEN, never let it read closed/empty — otherwise a month with failed imports
  // silently reads CLOSED.
  test("activity, zero backlog, but an orphan -> open (unbooked charge)", () =>
    expect(cellStatus({ hasActivity: true, backlogCount: 0, orphanCount: 1 })).toBe("open"));
  test("orphan-only month (no classified activity) -> open, NOT empty", () =>
    expect(cellStatus({ hasActivity: false, backlogCount: 0, orphanCount: 1 })).toBe("open"));
});

describe("rollupStatus (a month across entities, or an entity across months)", () => {
  test("nothing active -> empty", () =>
    expect(rollupStatus([{ hasActivity: false, backlogCount: 0, orphanCount: 0 }])).toBe("empty"));
  test("any cell still has backlog -> open", () =>
    expect(
      rollupStatus([
        { hasActivity: true, backlogCount: 0, orphanCount: 0 },
        { hasActivity: true, backlogCount: 2, orphanCount: 0 },
      ]),
    ).toBe("open"));
  test("active and all cleared -> closed", () =>
    expect(
      rollupStatus([
        { hasActivity: true, backlogCount: 0, orphanCount: 0 },
        { hasActivity: false, backlogCount: 0, orphanCount: 0 },
      ]),
    ).toBe("closed"));
  // C9: a cell whose only activity is an orphan rolls up to open (active + unbooked).
  test("an orphan-only cell rolls up to open, not empty", () =>
    expect(
      rollupStatus([
        { hasActivity: false, backlogCount: 0, orphanCount: 2 },
        { hasActivity: false, backlogCount: 0, orphanCount: 0 },
      ]),
    ).toBe("open"));
});

describe("summarizeMonths (year tax-close rollup)", () => {
  test("counts active/closed/open; not ready while a month is open", () => {
    expect(summarizeMonths(["closed", "closed", "open", "empty"])).toEqual({
      active: 3,
      closed: 2,
      open: 1,
      taxCloseReady: false,
    });
  });
  test("tax-close ready when every active month is closed", () => {
    expect(summarizeMonths(["closed", "closed", "empty"]).taxCloseReady).toBe(true);
  });
  test("a year with no activity is not 'ready'", () => {
    expect(summarizeMonths(["empty", "empty"]).taxCloseReady).toBe(false);
  });
});
