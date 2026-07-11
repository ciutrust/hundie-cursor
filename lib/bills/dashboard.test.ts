import { describe, expect, it } from "vitest";
import { buildBillsDashboard, type BillWithCategory } from "@/lib/bills/dashboard";
import type { BillInstance } from "@/lib/bills/types";

const today = "2026-07-15";

const entities = [
  { id: "e1", slug: "personal", name: "Personal", display_order: 1 },
  { id: "e2", slug: "gbsl", name: "GBSL", display_order: 0 },
];

// Factories take a loose override map so tests can inject STRING amounts (what PostgREST actually
// returns for numeric columns) even though the row types declare number.
function bill(over: Record<string, unknown> = {}): BillWithCategory {
  return {
    id: "b1", entity_id: "e1", name: "Bill", expected_amount: null, amount_varies: false,
    cadence: "monthly", due_day: 15, anchor_date: null, portal_url: null, login_hint: null,
    match_hint: null, category_id: null, status: "active", notes: null,
    created_at: "", updated_at: "", category: null, ...over,
  } as BillWithCategory;
}

function inst(over: Record<string, unknown> = {}): BillInstance {
  return {
    id: "i1", bill_id: "b1", entity_id: "e1", due_date: "2026-08-15", expected_amount: null,
    status: "open", paid_at: null, paid_amount: null, matched_transaction_id: null,
    created_at: "", updated_at: "", ...over,
  } as BillInstance;
}

describe("buildBillsDashboard", () => {
  it("sums STRING numeric amounts as numbers, not string-concatenation ($NaN regression)", () => {
    const dashboard = buildBillsDashboard({
      today,
      entities,
      bills: [
        bill({ id: "b1", entity_id: "e1", expected_amount: "100.00" }),
        bill({ id: "b2", entity_id: "e1", expected_amount: "50.00" }),
      ],
      instances: [
        inst({ id: "i1", bill_id: "b1", entity_id: "e1", due_date: "2026-08-01", expected_amount: "100.00" }),
        inst({ id: "i2", bill_id: "b2", entity_id: "e1", due_date: "2026-08-02", expected_amount: "50.00" }),
      ],
    });
    expect(dashboard.totalDue).toBe(150);
    expect(Number.isNaN(dashboard.totalDue)).toBe(false);
    expect(dashboard.groups[0].totalDue).toBe(150);
    expect(dashboard.outstandingCount).toBe(2);
  });

  it("excludes paid/skipped instances from the outstanding totals", () => {
    const dashboard = buildBillsDashboard({
      today,
      entities,
      bills: [bill({ id: "b1", entity_id: "e1", expected_amount: "100.00" })],
      instances: [
        inst({ id: "i1", bill_id: "b1", entity_id: "e1", due_date: "2026-07-01", status: "paid", expected_amount: "100.00" }),
      ],
    });
    expect(dashboard.totalDue).toBe(0);
    expect(dashboard.outstandingCount).toBe(0);
    expect(dashboard.groups[0].rows[0].state).toBe("paid");
  });

  it("orders groups by entity display_order", () => {
    const dashboard = buildBillsDashboard({
      today,
      entities,
      bills: [
        bill({ id: "b1", entity_id: "e1", expected_amount: "10.00" }),
        bill({ id: "b2", entity_id: "e2", expected_amount: "20.00" }),
      ],
      instances: [
        inst({ id: "i1", bill_id: "b1", entity_id: "e1", due_date: "2026-08-01", expected_amount: "10.00" }),
        inst({ id: "i2", bill_id: "b2", entity_id: "e2", due_date: "2026-08-01", expected_amount: "20.00" }),
      ],
    });
    expect(dashboard.groups.map((g) => g.entitySlug)).toEqual(["gbsl", "personal"]);
  });

  it("orders rows within a group by urgency (overdue first)", () => {
    const dashboard = buildBillsDashboard({
      today,
      entities,
      bills: [
        bill({ id: "b1", entity_id: "e1", expected_amount: "10.00" }),
        bill({ id: "b2", entity_id: "e1", expected_amount: "20.00" }),
      ],
      instances: [
        inst({ id: "i1", bill_id: "b1", entity_id: "e1", due_date: "2026-09-01" }), // upcoming
        inst({ id: "i2", bill_id: "b2", entity_id: "e1", due_date: "2026-06-01" }), // overdue
      ],
    });
    expect(dashboard.groups[0].rows.map((r) => r.state)).toEqual(["overdue", "upcoming"]);
  });
});
