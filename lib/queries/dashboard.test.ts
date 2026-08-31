import { describe, expect, it, vi } from "vitest";

// dashboard.ts imports review.ts (and the server Supabase client) — mock the module so the pure
// builders can be tested in the node runtime (same pattern as review-matrix.test.ts).
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import {
  buildDashboardTotals,
  buildReadinessSummary,
  monthIntersectsPeriod,
  yearsForPeriod,
} from "@/lib/queries/dashboard";
import type { EntityHomeStats } from "@/lib/queries/entity-home";
import type { MonthCloseCell } from "@/lib/month-close";
import { UNASSIGNED_MONTH_CLOSE_SLUG, type MonthCloseEntityRow } from "@/lib/queries/review";

function cell(overrides: Partial<MonthCloseCell> = {}): MonthCloseCell {
  return { hasActivity: false, backlogCount: 0, orphanCount: 0, changedCount: 0, ...overrides };
}

function row(slug: string, name: string, months: Record<number, MonthCloseCell>): MonthCloseEntityRow {
  return { slug, name, months };
}

describe("monthIntersectsPeriod", () => {
  it("is end-exclusive on the period end", () => {
    const period = { start: "2026-01-01", end: "2026-03-01" };
    expect(monthIntersectsPeriod(2026, 2, period)).toBe(true);
    expect(monthIntersectsPeriod(2026, 3, period)).toBe(false); // period ends exactly at Mar 1
  });

  it("includes a month the period starts in the middle of", () => {
    const period = { start: "2026-02-15", end: "2026-02-20" };
    expect(monthIntersectsPeriod(2026, 2, period)).toBe(true);
    expect(monthIntersectsPeriod(2026, 1, period)).toBe(false);
  });

  it("rolls December into the next year correctly", () => {
    const period = { start: "2025-12-31", end: "2026-01-02" };
    expect(monthIntersectsPeriod(2025, 12, period)).toBe(true);
    expect(monthIntersectsPeriod(2026, 1, period)).toBe(true);
  });
});

describe("yearsForPeriod", () => {
  const bounds = { minYear: 2025, maxYear: 2026 };

  it("clamps the all-time 1970 start to the ledger's first year", () => {
    expect(yearsForPeriod({ start: "1970-01-01", end: "2026-09-01" }, bounds)).toEqual([2025, 2026]);
  });

  it("treats an exact Jan-1 end as excluding that year", () => {
    expect(yearsForPeriod({ start: "2025-03-01", end: "2026-01-01" }, bounds)).toEqual([2025]);
  });

  it("returns a single year for an in-year period", () => {
    expect(yearsForPeriod({ start: "2026-04-01", end: "2026-07-01" }, bounds)).toEqual([2026]);
  });

  it("returns empty when the period is entirely outside the ledger", () => {
    expect(yearsForPeriod({ start: "2027-01-01", end: "2028-01-01" }, bounds)).toEqual([]);
  });
});

describe("buildReadinessSummary", () => {
  const matrices = [
    {
      year: 2026,
      rows: [
        // Deliberately out of chronological order to prove the year sort.
        row("gbsl", "GBSL", {
          1: cell({ hasActivity: true, backlogCount: 5 }),
          2: cell(), // empty
          3: cell({ hasActivity: true, backlogCount: 9 }), // open but OUTSIDE the period
        }),
        row(UNASSIGNED_MONTH_CLOSE_SLUG, "Unassigned (no entity)", {
          1: cell({ hasActivity: true, orphanCount: 1 }),
        }),
      ],
    },
    {
      year: 2025,
      rows: [
        row("gbsl", "GBSL", {
          11: cell({ hasActivity: true, backlogCount: 3 }),
          12: cell({ hasActivity: true }), // closed — never emitted
        }),
        row("personal", "Personal", {
          11: cell({ hasActivity: true, orphanCount: 2 }), // orphan-only → still open
        }),
      ],
    },
  ];
  const period = { start: "2025-11-01", end: "2026-02-01" };

  it("keeps only OPEN cells inside the period, ordered year → month → entity row order", () => {
    const summary = buildReadinessSummary(matrices, period);
    expect(summary.openCells).toEqual([
      { entitySlug: "gbsl", entityName: "GBSL", year: 2025, month: 11, backlogCount: 3, orphanCount: 0 },
      { entitySlug: "personal", entityName: "Personal", year: 2025, month: 11, backlogCount: 0, orphanCount: 2 },
      { entitySlug: "gbsl", entityName: "GBSL", year: 2026, month: 1, backlogCount: 5, orphanCount: 0 },
      {
        entitySlug: UNASSIGNED_MONTH_CLOSE_SLUG,
        entityName: "Unassigned (no entity)",
        year: 2026,
        month: 1,
        backlogCount: 0,
        orphanCount: 1,
      },
    ]);
  });

  it("totals orphans and counts distinct open (year, month) pairs", () => {
    const summary = buildReadinessSummary(matrices, period);
    expect(summary.orphanTotal).toBe(3); // 2 (personal) + 1 (unassigned)
    expect(summary.openMonthCount).toBe(2); // 2025-11 and 2026-01
  });

  it("returns an empty summary when every in-period cell is closed or empty", () => {
    const summary = buildReadinessSummary(matrices, { start: "2025-12-01", end: "2026-01-01" });
    expect(summary).toEqual({ openCells: [], orphanTotal: 0, openMonthCount: 0 });
  });
});

describe("buildDashboardTotals", () => {
  function stats(overrides: Partial<EntityHomeStats>): EntityHomeStats {
    return {
      slug: "x",
      name: "X",
      expenseTotal: 0,
      transactionCount: 0,
      unclassifiedCount: 0,
      unclassifiedTotal: 0,
      unclassifiedExpenseCount: 0,
      unclassifiedExpenseTotal: 0,
      unclassifiedIncomeCount: 0,
      unclassifiedIncomeTotal: 0,
      topCategory: null,
      incomeTotal: 0,
      netTotal: 0,
      topCategories: [],
      ...overrides,
    };
  }

  it("sums across entities and composes the combined to-classify dollars from BOTH flows", () => {
    const totals = buildDashboardTotals([
      stats({
        slug: "gbsl",
        incomeTotal: 2000,
        expenseTotal: 1150,
        unclassifiedCount: 4,
        unclassifiedTotal: 800, // expense-side only (historical meaning)
        unclassifiedExpenseCount: 2,
        unclassifiedExpenseTotal: 800,
        unclassifiedIncomeCount: 1,
        unclassifiedIncomeTotal: 50,
      }),
      stats({
        slug: "personal",
        incomeTotal: 500,
        expenseTotal: 700,
        unclassifiedCount: 1,
        unclassifiedTotal: 120,
        unclassifiedExpenseCount: 1,
        unclassifiedExpenseTotal: 120,
      }),
    ]);

    expect(totals.incomeTotal).toBe(2500);
    expect(totals.expenseTotal).toBe(1850);
    expect(totals.netTotal).toBe(650);
    expect(totals.unclassifiedCount).toBe(5);
    expect(totals.unclassifiedExpenseCount).toBe(3);
    expect(totals.unclassifiedExpenseTotal).toBe(920);
    expect(totals.unclassifiedIncomeCount).toBe(1);
    expect(totals.unclassifiedIncomeTotal).toBe(50);
    // NOT Σ stats.unclassifiedTotal (which is expense-only): expense$ + income$.
    expect(totals.unclassifiedTotal).toBe(970);
  });

  it("returns zeros for no entities", () => {
    expect(buildDashboardTotals([]).netTotal).toBe(0);
  });
});
