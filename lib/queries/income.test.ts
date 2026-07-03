import { describe, expect, it, vi, beforeEach } from "vitest";

// getIncomeSummary calls createClient() from "@/lib/supabase/server"; we mock that module so the test
// drives a purpose-built in-memory client. The income query embeds `classifications(...)` as a nested
// PostgREST select, which the generic fake-supabase's naive comma-split projection cannot reconstruct,
// so this client returns pre-shaped IncomeRow objects directly and — crucially — honors the
// `.is("plaid_removed_at", null)` filter the C4 fix must apply.

const mockCreateClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => mockCreateClient(),
}));

import { getIncomeSummary } from "./income";
import type { PeriodRange } from "@/lib/period";

type SeedTxn = {
  id: string;
  amount: number;
  entity_id: string;
  full_path: string | null;
  plaid_removed_at: string | null;
};

/**
 * A tiny fake supabase whose `transactions` builder tracks the `.is()` filters and applies them to the
 * seeded rows, then shapes each surviving row into the nested IncomeRow the real embed would return.
 * The `entities` builder returns the seeded classifiable entities.
 */
function fakeClient(entities: Array<{ id: string; name: string; slug: string; display_order: number }>, txns: SeedTxn[]) {
  function transactionsBuilder() {
    const filters: Array<{ col: string; val: unknown }> = [];
    const q: Record<string, unknown> = {};
    const chain = () => q;
    Object.assign(q, {
      select: chain,
      gte: chain,
      lt: chain,
      order: chain,
      range: chain,
      is: (col: string, val: unknown) => {
        filters.push({ col, val });
        return q;
      },
      then: (resolve: (v: { data: unknown[]; error: null }) => unknown) => {
        const removedFilter = filters.some((f) => f.col === "plaid_removed_at" && f.val === null);
        const surviving = txns.filter((t) => (removedFilter ? t.plaid_removed_at == null : true));
        const data = surviving.map((t) => ({
          id: t.id,
          amount: t.amount,
          classifications: {
            entity_id: t.entity_id,
            category_id: "cat-" + t.id,
            categories: { full_path: t.full_path },
          },
        }));
        return resolve({ data, error: null });
      },
    });
    return q;
  }

  function entitiesBuilder() {
    const q: Record<string, unknown> = {};
    const chain = () => q;
    Object.assign(q, {
      select: chain,
      eq: chain,
      order: () => Promise.resolve({ data: entities, error: null }),
    });
    return q;
  }

  return {
    from: (table: string) => (table === "entities" ? entitiesBuilder() : transactionsBuilder()),
  };
}

const ENTITIES = [{ id: "ent-1", name: "GBSL", slug: "gbsl", display_order: 1 }];
// getIncomeSummary only reads { start, end }; the rest of PeriodRange is irrelevant here.
const PERIOD = { start: "2026-01-01", end: "2027-01-01" } as unknown as PeriodRange;

beforeEach(() => {
  mockCreateClient.mockReset();
});

describe("getIncomeSummary — C4: Plaid-removed rows must not count", () => {
  it("excludes a plaid_removed_at income row from incomeTotal + byCategory", async () => {
    mockCreateClient.mockResolvedValue(
      fakeClient(ENTITIES, [
        // a normal, still-booked income inflow (negative amount; magnitude counted)
        { id: "t-keep", amount: -100, entity_id: "ent-1", full_path: "Membership Income", plaid_removed_at: null },
        // a Plaid-REVERSED income charge — row is retained with its classification, must NOT count
        { id: "t-removed", amount: -500, entity_id: "ent-1", full_path: "Membership Income", plaid_removed_at: "2026-06-01T00:00:00Z" },
      ]),
    );

    const out = await getIncomeSummary(PERIOD);
    const gbsl = out.find((e) => e.slug === "gbsl")!;
    // Only the kept row (magnitude 100) counts; the removed 500 is excluded.
    expect(gbsl.incomeTotal).toBe(100);
    expect(gbsl.byCategory).toEqual([{ category: "Membership Income", total: 100, count: 1 }]);
  });

  it("excludes a plaid_removed_at booked-operating-expense row from expenseTotal", async () => {
    mockCreateClient.mockResolvedValue(
      fakeClient(ENTITIES, [
        // a booked operating expense that is still live (positive amount)
        { id: "t-exp", amount: 80, entity_id: "ent-1", full_path: "Rent expense", plaid_removed_at: null },
        // a Plaid-REVERSED booked expense — must NOT count toward expenseTotal
        { id: "t-exp-removed", amount: 300, entity_id: "ent-1", full_path: "Rent expense", plaid_removed_at: "2026-06-01T00:00:00Z" },
      ]),
    );

    const out = await getIncomeSummary(PERIOD);
    const gbsl = out.find((e) => e.slug === "gbsl")!;
    expect(gbsl.expenseTotal).toBe(80);
    expect(gbsl.incomeTotal).toBe(0);
    expect(gbsl.net).toBe(-80); // 0 income − 80 expense
  });
});
