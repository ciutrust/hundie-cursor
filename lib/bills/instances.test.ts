import { describe, expect, it } from "vitest";
import { computeDueInstances, type BillDef } from "@/lib/bills/instances";

function bill(overrides: Partial<BillDef> = {}): BillDef {
  return {
    id: "bill-1",
    entity_id: "entity-1",
    cadence: "monthly",
    due_day: 15,
    anchor_date: null,
    expected_amount: 84.12,
    status: "active",
    ...overrides,
  };
}

const dueDates = (rows: { due_date: string }[]) => rows.map((r) => r.due_date);

describe("computeDueInstances — new bill (no latest)", () => {
  it("seeds an overdue current cycle plus the next when the due day has passed this month", () => {
    const rows = computeDueInstances({ bill: bill({ due_day: 5 }), latestDueDate: null, today: "2026-07-20" });
    expect(dueDates(rows)).toEqual(["2026-07-05", "2026-08-05"]);
  });

  it("seeds only the upcoming current cycle when the due day is still ahead this month", () => {
    const rows = computeDueInstances({ bill: bill({ due_day: 25 }), latestDueDate: null, today: "2026-07-10" });
    expect(dueDates(rows)).toEqual(["2026-07-25"]);
  });

  it("carries entity_id and expected_amount onto every emitted row", () => {
    const rows = computeDueInstances({ bill: bill({ due_day: 5 }), latestDueDate: null, today: "2026-07-20" });
    for (const row of rows) {
      expect(row.bill_id).toBe("bill-1");
      expect(row.entity_id).toBe("entity-1");
      expect(row.expected_amount).toBe(84.12);
    }
  });

  it("emits exactly one row at the anchor for a one_time bill, then nothing once it exists", () => {
    const oneTime = bill({ cadence: "one_time", due_day: null, anchor_date: "2026-09-01" });
    expect(dueDates(computeDueInstances({ bill: oneTime, latestDueDate: null, today: "2026-07-10" }))).toEqual([
      "2026-09-01",
    ]);
    expect(
      computeDueInstances({ bill: oneTime, latestDueDate: "2026-09-01", today: "2026-07-10" }),
    ).toEqual([]);
  });
});

describe("computeDueInstances — continuation (has latest)", () => {
  it("returns nothing when the newest instance is already in the future", () => {
    expect(
      computeDueInstances({ bill: bill(), latestDueDate: "2026-08-15", today: "2026-07-20" }),
    ).toEqual([]);
  });

  it("fills forward from the latest up to the first cycle after today", () => {
    // latest is May, today is July → June + July should be created (July is the first after today? no,
    // July 15 < July 20, so we also need August).
    const rows = computeDueInstances({ bill: bill({ due_day: 15 }), latestDueDate: "2026-05-15", today: "2026-07-20" });
    expect(dueDates(rows)).toEqual(["2026-06-15", "2026-07-15", "2026-08-15"]);
  });

  it("preserves the due_day anchor across month-end clamps (no drift)", () => {
    // A day-31 bill clamped to Feb 28 must still land on Mar 31, not Mar 28.
    const rows = computeDueInstances({ bill: bill({ due_day: 31 }), latestDueDate: "2026-02-28", today: "2026-03-15" });
    expect(dueDates(rows)).toEqual(["2026-03-31"]);
  });

  it("is idempotent once the current cycle exists and is the latest on-or-before today", () => {
    // latest == this month's due, today just after it → only next month is missing.
    const rows = computeDueInstances({ bill: bill({ due_day: 15 }), latestDueDate: "2026-07-15", today: "2026-07-16" });
    expect(dueDates(rows)).toEqual(["2026-08-15"]);
  });
});

describe("computeDueInstances — schedules & guards", () => {
  it("rolls an annual anchor in the past forward to the current cycle", () => {
    const annual = bill({ cadence: "annual", due_day: 1, anchor_date: "2023-04-01" });
    const rows = computeDueInstances({ bill: annual, latestDueDate: null, today: "2026-07-20" });
    // current cycle = 2026-04-01 (overdue), next = 2027-04-01
    expect(dueDates(rows)).toEqual(["2026-04-01", "2027-04-01"]);
  });

  it("does not generate for a paused or archived bill", () => {
    expect(
      computeDueInstances({ bill: bill({ status: "paused" }), latestDueDate: null, today: "2026-07-20" }),
    ).toEqual([]);
    expect(
      computeDueInstances({ bill: bill({ status: "archived" }), latestDueDate: "2026-01-15", today: "2026-07-20" }),
    ).toEqual([]);
  });

  it("respects the horizon cap", () => {
    const rows = computeDueInstances({
      bill: bill({ due_day: 15 }),
      latestDueDate: "2020-01-15",
      today: "2026-07-20",
      horizon: 3,
    });
    expect(rows.length).toBe(3);
  });
});
