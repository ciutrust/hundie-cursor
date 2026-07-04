import { describe, expect, it, vi, beforeEach } from "vitest";

// fetchLedgerExpenseLines sources non-split transactions (Fetch A, via fetchPeriodTransactions) PLUS
// split legs (Fetch B, transaction_splits) and merges them. This fake supabase honors the two filters
// that make splits correct — `split_at IS NULL` on Fetch A (drops split parents) and the LEG's own
// `entity_id` on Fetch B — so we can assert the merge/mapping without a real DB.

const mockCreateClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: () => mockCreateClient() }));

import { fetchLedgerExpenseLines } from "./ledger-expense-lines";

type SeedTxn = {
  id: string;
  amount: number;
  entity_id: string;
  entity_slug: string;
  full_path: string;
  split_at: string | null;
  plaid_removed_at: string | null;
};
type SeedLeg = {
  id: string;
  parent_id: string;
  entity_id: string;
  entity_slug: string;
  full_path: string;
  amount: number;
  parent: SeedTxn;
};

function fakeClient(txns: SeedTxn[], legs: SeedLeg[]) {
  function transactionsBuilder() {
    const isFilters: Array<{ col: string; val: unknown }> = [];
    const eqFilters: Array<{ col: string; val: unknown }> = [];
    const q: Record<string, unknown> = {};
    const chain = () => q;
    Object.assign(q, {
      select: chain,
      gte: chain,
      lt: chain,
      order: chain,
      range: chain,
      in: chain,
      is: (col: string, val: unknown) => (isFilters.push({ col, val }), q),
      eq: (col: string, val: unknown) => (eqFilters.push({ col, val }), q),
      then: (resolve: (v: { data: unknown[]; error: null }) => unknown) => {
        const dropRemoved = isFilters.some((f) => f.col === "plaid_removed_at" && f.val === null);
        const dropSplit = isFilters.some((f) => f.col === "split_at" && f.val === null);
        const entityEq = eqFilters.find((f) => f.col === "classification.entity_id");
        const surviving = txns.filter(
          (t) =>
            (!dropRemoved || t.plaid_removed_at == null) &&
            (!dropSplit || t.split_at == null) &&
            (!entityEq || t.entity_id === entityEq.val),
        );
        return resolve({
          data: surviving.map((t) => ({
            id: t.id,
            transaction_date: "2026-03-10",
            amount: t.amount,
            description: "whole " + t.id,
            vendor: null,
            account: { id: "acc-1", display_name: "Acct", slug: "acct", account_type: "checking" },
            classification: {
              entity_id: t.entity_id,
              category_id: "cat-" + t.id,
              notes: null,
              entity: { id: t.entity_id, name: t.entity_id, slug: t.entity_slug },
              category: { id: "cat-" + t.id, full_path: t.full_path, tax_form: null, tax_line: null },
            },
          })),
          error: null,
        });
      },
    });
    return q;
  }

  function splitsBuilder() {
    const eqFilters: Array<{ col: string; val: unknown }> = [];
    const q: Record<string, unknown> = {};
    const chain = () => q;
    Object.assign(q, {
      select: chain,
      gte: chain,
      lt: chain,
      is: chain,
      order: chain,
      range: chain,
      in: chain,
      eq: (col: string, val: unknown) => (eqFilters.push({ col, val }), q),
      then: (resolve: (v: { data: unknown[]; error: null }) => unknown) => {
        const entityEq = eqFilters.find((f) => f.col === "entity_id");
        const surviving = legs.filter((l) => !entityEq || l.entity_id === entityEq.val);
        return resolve({
          data: surviving.map((l) => ({
            id: l.id,
            entity_id: l.entity_id,
            category_id: "cat-" + l.id,
            amount: l.amount,
            transaction: {
              id: l.parent.id,
              transaction_date: "2026-03-10",
              description: "whole " + l.parent.id,
              vendor: null,
              account: { id: "acc-1", display_name: "Acct", slug: "acct", account_type: "checking" },
            },
            entity: { id: l.entity_id, name: l.entity_id, slug: l.entity_slug },
            category: { id: "cat-" + l.id, full_path: l.full_path, tax_form: null, tax_line: null },
          })),
          error: null,
        });
      },
    });
    return q;
  }

  return {
    from: (table: string) => (table === "transaction_splits" ? splitsBuilder() : transactionsBuilder()),
  };
}

const parent: SeedTxn = {
  id: "t-split",
  amount: 710.37,
  entity_id: "personal",
  entity_slug: "personal",
  full_path: "Utilities — primary residence",
  split_at: "2026-07-01T00:00:00Z",
  plaid_removed_at: null,
};
const normal: SeedTxn = {
  id: "t-normal",
  amount: 100,
  entity_id: "personal",
  entity_slug: "personal",
  full_path: "Groceries & household",
  split_at: null,
  plaid_removed_at: null,
};
const legPersonal: SeedLeg = {
  id: "leg-p", parent_id: "t-split", entity_id: "personal", entity_slug: "personal",
  full_path: "Utilities — primary residence", amount: 568.88, parent,
};
const legAcaa: SeedLeg = {
  id: "leg-a", parent_id: "t-split", entity_id: "acaa-austin", entity_slug: "acaa-austin",
  full_path: "Utilities — rental", amount: 141.49, parent,
};

beforeEach(() => mockCreateClient.mockReset());

describe("fetchLedgerExpenseLines — splits", () => {
  const opts = { start: "2026-01-01", end: "2027-01-01" };

  it("replaces a split parent with its legs and keeps normal transactions", async () => {
    const supabase = fakeClient([normal, parent], [legPersonal, legAcaa]) as never;
    const lines = await fetchLedgerExpenseLines({ supabase, ...opts });

    // The split parent's WHOLE line is gone; its two legs + the normal tx are present.
    expect(lines.map((l) => l.id).sort()).toEqual(["t-normal", "t-split", "t-split"]);
    expect(lines.some((l) => l.legId === null && l.id === "t-split")).toBe(false);

    // Legs carry the LEG's entity + the parent's date/description.
    const acaaLeg = lines.find((l) => l.classification.entity_id === "acaa-austin")!;
    expect(acaaLeg.amount).toBe(141.49);
    expect(acaaLeg.classification.category?.full_path).toBe("Utilities — rental");
    expect(acaaLeg.description).toBe("whole t-split");
    expect(acaaLeg.legId).toBe("leg-a");

    // Parity: the legs sum to the parent, so total ledger amount is unchanged by the split.
    const total = lines.reduce((s, l) => s + l.amount, 0);
    expect(Math.round(total * 100)).toBe(Math.round((100 + 710.37) * 100));
  });

  it("entity-scopes by the LEG's own entity, not the parent's classification entity", async () => {
    const supabase = fakeClient([normal, parent], [legPersonal, legAcaa]) as never;
    // Austin ACAA view: the ACAA leg surfaces even though the parent classification is Personal.
    const acaa = await fetchLedgerExpenseLines({ supabase, ...opts, entityId: "acaa-austin" });
    expect(acaa).toHaveLength(1);
    expect(acaa[0].classification.entity_id).toBe("acaa-austin");
    expect(acaa[0].amount).toBe(141.49);
  });

  it("excludes a Plaid-removed transaction from the whole-row side", async () => {
    const removed: SeedTxn = { ...normal, id: "t-removed", plaid_removed_at: "2026-06-01T00:00:00Z" };
    const supabase = fakeClient([normal, removed], []) as never;
    const lines = await fetchLedgerExpenseLines({ supabase, ...opts });
    expect(lines.map((l) => l.id)).toEqual(["t-normal"]);
  });
});
