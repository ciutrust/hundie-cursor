import { afterEach, describe, expect, it, vi } from "vitest";
import { makeFakeSupabase } from "../../../tests/helpers/fake-supabase.mjs";
import type { CreateBillInput } from "@/lib/actions/bills";

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

function setup(initial: Record<string, unknown[]>) {
  const client = makeFakeSupabase(initial) as { from: unknown; db: Record<string, any[]> };
  vi.doMock("@/lib/auth/require-user", () => ({
    requireUser: async () => ({ error: null, user: { id: "u1", email: "u@x.com" }, supabase: client }),
  }));
  vi.doMock("next/cache", () => ({ revalidatePath: () => {} }));
  return { client, db: client.db };
}

function billInput(overrides: Partial<CreateBillInput> = {}): CreateBillInput {
  return {
    entityId: "ent-A",
    name: "TXU Electric",
    expectedAmount: 142,
    amountVaries: false,
    cadence: "monthly",
    dueDay: 15,
    anchorDate: null,
    portalUrl: "https://txu.com",
    loginHint: null,
    matchHint: "TXU",
    categoryId: null,
    notes: null,
    ...overrides,
  };
}

const activeBill = {
  id: "bill-1",
  entity_id: "ent-A",
  cadence: "monthly",
  due_day: 15,
  anchor_date: null,
  expected_amount: 100,
  status: "active",
};

function openInstance(overrides: Record<string, unknown> = {}) {
  return {
    id: "inst-1",
    bill_id: "bill-1",
    entity_id: "ent-A",
    due_date: "2026-07-15",
    expected_amount: 100,
    status: "open",
    paid_at: null,
    paid_amount: null,
    matched_transaction_id: null,
    ...overrides,
  };
}

describe("createBill", () => {
  it("inserts a bill", async () => {
    const { db } = setup({ categories: [{ id: "cat-A", entity_id: "ent-A" }], bills: [] });
    const { createBill } = await import("@/lib/actions/bills");
    const res = await createBill(billInput());
    expect(res).toMatchObject({ success: true });
    expect(db.bills).toHaveLength(1);
    expect(db.bills[0].name).toBe("TXU Electric");
    expect(db.bills[0].match_hint).toBe("TXU");
  });

  it("rejects a category that does not belong to the entity", async () => {
    const { db } = setup({ categories: [{ id: "cat-A", entity_id: "ent-OTHER" }], bills: [] });
    const { createBill } = await import("@/lib/actions/bills");
    const res = await createBill(billInput({ categoryId: "cat-A" }));
    expect(res).toEqual({ error: "Category does not belong to the selected entity" });
    expect(db.bills).toHaveLength(0);
  });
});

describe("updateBill", () => {
  it("re-syncs bill_instances.entity_id when the bill is moved to another entity", async () => {
    const { db } = setup({
      categories: [],
      bills: [{ ...activeBill, entity_id: "ent-A" }],
      bill_instances: [openInstance({ entity_id: "ent-A" })],
    });
    const { updateBill } = await import("@/lib/actions/bills");
    const res = await updateBill("bill-1", billInput({ entityId: "ent-B", categoryId: null }));
    expect(res).toEqual({ success: true });
    expect(db.bills.find((b) => b.id === "bill-1").entity_id).toBe("ent-B");
    // The open instance must follow the bill's new entity — else it is matched against the wrong ledger.
    expect(db.bill_instances.find((i) => i.id === "inst-1").entity_id).toBe("ent-B");
  });
});

describe("confirmBillPayment", () => {
  it("marks the instance paid, links the transaction, and creates the next cycle", async () => {
    const { db } = setup({ bills: [{ ...activeBill }], bill_instances: [openInstance()] });
    const { confirmBillPayment } = await import("@/lib/actions/bills");
    const res = await confirmBillPayment({ instanceId: "inst-1", transactionId: "tx-9" });
    expect(res).toEqual({ success: true });

    const paid = db.bill_instances.find((i) => i.id === "inst-1");
    expect(paid.status).toBe("paid");
    expect(paid.matched_transaction_id).toBe("tx-9");
    expect(paid.paid_at).toBeTruthy();

    const next = db.bill_instances.find((i) => i.due_date === "2026-08-15");
    expect(next).toBeTruthy();
    expect(next.status).toBe("open");
    expect(next.bill_id).toBe("bill-1");
  });

  it("is a no-op on an already-resolved instance (never double-confirms)", async () => {
    const { db } = setup({
      bills: [{ ...activeBill }],
      bill_instances: [openInstance({ status: "paid", matched_transaction_id: "tx-old" })],
    });
    const { confirmBillPayment } = await import("@/lib/actions/bills");
    const res = await confirmBillPayment({ instanceId: "inst-1", transactionId: "tx-9" });
    expect(res).toMatchObject({ error: expect.stringContaining("not open") });
    expect(db.bill_instances).toHaveLength(1); // no next cycle created
    expect(db.bill_instances[0].matched_transaction_id).toBe("tx-old");
  });
});

describe("unlinkBillPayment", () => {
  it("reverts a paid instance back to open and clears the paid fields", async () => {
    const { db } = setup({
      bills: [{ ...activeBill }],
      bill_instances: [
        openInstance({ status: "paid", matched_transaction_id: "tx-9", paid_amount: 100, paid_at: "2026-07-14T00:00:00Z" }),
      ],
    });
    const { unlinkBillPayment } = await import("@/lib/actions/bills");
    const res = await unlinkBillPayment("inst-1");
    expect(res).toEqual({ success: true });
    const inst = db.bill_instances[0];
    expect(inst.status).toBe("open");
    expect(inst.matched_transaction_id).toBeNull();
    expect(inst.paid_amount).toBeNull();
    expect(inst.paid_at).toBeNull();
  });
});

describe("skipBillInstance", () => {
  it("skips an open instance and rolls the cycle forward", async () => {
    const { db } = setup({ bills: [{ ...activeBill }], bill_instances: [openInstance()] });
    const { skipBillInstance } = await import("@/lib/actions/bills");
    const res = await skipBillInstance("inst-1");
    expect(res).toEqual({ success: true });
    expect(db.bill_instances.find((i) => i.id === "inst-1").status).toBe("skipped");
    expect(db.bill_instances.find((i) => i.due_date === "2026-08-15")).toBeTruthy();
  });
});

describe("acceptSeededBills", () => {
  it("bulk-inserts the accepted candidates", async () => {
    const { db } = setup({ categories: [], bills: [] });
    const { acceptSeededBills } = await import("@/lib/actions/bills");
    const res = await acceptSeededBills([
      billInput({ name: "Netflix", categoryId: null }),
      billInput({ name: "City Water", entityId: "ent-B", categoryId: null }),
    ]);
    expect(res).toEqual({ success: true, count: 2 });
    expect(db.bills).toHaveLength(2);
    expect(db.bills.map((b) => b.name).sort()).toEqual(["City Water", "Netflix"]);
  });
});
