import { describe, expect, it } from "vitest";
import { makeFakeSupabase } from "../../tests/helpers/fake-supabase.mjs";
import { ensureBillInstances } from "@/lib/queries/bills";

const monthlyBill = {
  id: "bill-1",
  entity_id: "ent-1",
  cadence: "monthly" as const,
  due_day: 15,
  anchor_date: null,
  expected_amount: 100,
  status: "active" as const,
};

const dues = (rows: { due_date: string }[]) => rows.map((r) => r.due_date).sort();

describe("ensureBillInstances", () => {
  it("seeds the current + next cycle for a new bill, and is idempotent", async () => {
    const sb = makeFakeSupabase({ bill_instances: [] }) as any;
    await ensureBillInstances(sb, [monthlyBill], "2026-07-20");

    expect(dues(sb.db.bill_instances)).toEqual(["2026-07-15", "2026-08-15"]);
    expect(sb.db.bill_instances.every((r: any) => r.status === "open")).toBe(true);
    const countAfterFirst = sb.db.bill_instances.length;

    // A second pass with the same "today" must add nothing (unique (bill_id, due_date) + ignoreDuplicates).
    await ensureBillInstances(sb, [monthlyBill], "2026-07-20");
    expect(sb.db.bill_instances.length).toBe(countAfterFirst);
  });

  it("fills forward from the latest existing instance without touching it", async () => {
    const sb = makeFakeSupabase({
      bill_instances: [
        { id: "i1", bill_id: "bill-1", entity_id: "ent-1", due_date: "2026-05-15", status: "paid" },
      ],
    }) as any;
    await ensureBillInstances(sb, [monthlyBill], "2026-07-20");

    expect(dues(sb.db.bill_instances)).toEqual([
      "2026-05-15",
      "2026-06-15",
      "2026-07-15",
      "2026-08-15",
    ]);
    // The pre-existing paid instance is untouched.
    expect(sb.db.bill_instances.find((r: any) => r.id === "i1").status).toBe("paid");
  });
});
