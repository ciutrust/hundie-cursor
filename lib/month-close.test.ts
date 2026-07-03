import { describe, expect, test } from "vitest";
import { cellStatus, isChangedSinceClose, rollupStatus, summarizeMonths } from "./month-close";

describe("cellStatus", () => {
  test("no activity -> empty", () =>
    expect(cellStatus({ hasActivity: false, backlogCount: 0, orphanCount: 0, changedCount: 0 })).toBe(
      "empty",
    ));
  test("activity, zero backlog -> closed (CPA-ready)", () =>
    expect(cellStatus({ hasActivity: true, backlogCount: 0, orphanCount: 0, changedCount: 0 })).toBe(
      "closed",
    ));
  test("activity with backlog (unclassified or AMA) -> open", () =>
    expect(cellStatus({ hasActivity: true, backlogCount: 3, orphanCount: 0, changedCount: 0 })).toBe(
      "open",
    ));

  // C9: an orphan (a transactions row with no classifications row) is an unbooked charge. It must
  // keep the month OPEN, never let it read closed/empty — otherwise a month with failed imports
  // silently reads CLOSED.
  test("activity, zero backlog, but an orphan -> open (unbooked charge)", () =>
    expect(cellStatus({ hasActivity: true, backlogCount: 0, orphanCount: 1, changedCount: 0 })).toBe(
      "open",
    ));
  test("orphan-only month (no classified activity) -> open, NOT empty", () =>
    expect(cellStatus({ hasActivity: false, backlogCount: 0, orphanCount: 1, changedCount: 0 })).toBe(
      "open",
    ));

  // C8: changedCount is a WARNING indicator ONLY — it must NEVER move cellStatus. A closed cell with
  // changes is still "closed"; an empty cell with changes is still "empty".
  test("changedCount does NOT affect status: closed + changes -> still closed", () =>
    expect(cellStatus({ hasActivity: true, backlogCount: 0, orphanCount: 0, changedCount: 5 })).toBe(
      "closed",
    ));
  test("changedCount does NOT affect status: no activity + changes -> still empty", () =>
    expect(cellStatus({ hasActivity: false, backlogCount: 0, orphanCount: 0, changedCount: 5 })).toBe(
      "empty",
    ));
});

describe("rollupStatus (a month across entities, or an entity across months)", () => {
  test("nothing active -> empty", () =>
    expect(
      rollupStatus([{ hasActivity: false, backlogCount: 0, orphanCount: 0, changedCount: 0 }]),
    ).toBe("empty"));
  test("any cell still has backlog -> open", () =>
    expect(
      rollupStatus([
        { hasActivity: true, backlogCount: 0, orphanCount: 0, changedCount: 0 },
        { hasActivity: true, backlogCount: 2, orphanCount: 0, changedCount: 0 },
      ]),
    ).toBe("open"));
  test("active and all cleared -> closed", () =>
    expect(
      rollupStatus([
        { hasActivity: true, backlogCount: 0, orphanCount: 0, changedCount: 0 },
        { hasActivity: false, backlogCount: 0, orphanCount: 0, changedCount: 0 },
      ]),
    ).toBe("closed"));
  // C9: a cell whose only activity is an orphan rolls up to open (active + unbooked).
  test("an orphan-only cell rolls up to open, not empty", () =>
    expect(
      rollupStatus([
        { hasActivity: false, backlogCount: 0, orphanCount: 2, changedCount: 0 },
        { hasActivity: false, backlogCount: 0, orphanCount: 0, changedCount: 0 },
      ]),
    ).toBe("open"));
  // C8: a closed rollup with changed cells stays closed — changedCount is a separate warning.
  test("changedCount does NOT affect rollup: all cleared + changes -> still closed", () =>
    expect(
      rollupStatus([
        { hasActivity: true, backlogCount: 0, orphanCount: 0, changedCount: 4 },
        { hasActivity: true, backlogCount: 0, orphanCount: 0, changedCount: 0 },
      ]),
    ).toBe("closed"));
});

describe("isChangedSinceClose (C8 warning indicator)", () => {
  // Only a month that OTHERWISE reads closed but has post-close field changes is a warning.
  test("closed + changedCount>0 -> true", () =>
    expect(
      isChangedSinceClose({ hasActivity: true, backlogCount: 0, orphanCount: 0, changedCount: 2 }),
    ).toBe(true));
  test("open + changedCount>0 -> false (open already flags work; not a 'since close' warning)", () =>
    expect(
      isChangedSinceClose({ hasActivity: true, backlogCount: 3, orphanCount: 0, changedCount: 2 }),
    ).toBe(false));
  test("closed + changedCount 0 -> false", () =>
    expect(
      isChangedSinceClose({ hasActivity: true, backlogCount: 0, orphanCount: 0, changedCount: 0 }),
    ).toBe(false));
  test("empty cell -> false", () =>
    expect(
      isChangedSinceClose({ hasActivity: false, backlogCount: 0, orphanCount: 0, changedCount: 0 }),
    ).toBe(false));
  test("empty cell with a stray change count -> false (not active, not closed)", () =>
    expect(
      isChangedSinceClose({ hasActivity: false, backlogCount: 0, orphanCount: 0, changedCount: 5 }),
    ).toBe(false));
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
