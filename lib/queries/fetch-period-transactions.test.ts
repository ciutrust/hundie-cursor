import { describe, expect, it } from "vitest";
import {
  fetchPeriodTransactions,
  type FetchPeriodTransactionsOptions,
} from "@/lib/queries/fetch-period-transactions";

/**
 * A chainable query recorder: every builder method returns the same object, `.order()` records the
 * column, and awaiting it resolves to an empty page (so paginateAll stops after one fetch). We only
 * care which columns the query orders by.
 */
function recordingClient() {
  const orderCalls: string[] = [];
  const q: Record<string, unknown> = {};
  const chain = () => q;
  Object.assign(q, {
    select: chain,
    gte: chain,
    lt: chain,
    range: chain,
    eq: chain,
    order: (col: string) => {
      orderCalls.push(col);
      return q;
    },
    then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
      resolve({ data: [], error: null }),
  });
  const supabase = { from: () => q };
  return { supabase, orderCalls };
}

function optsFor(supabase: unknown, order?: "asc" | "desc"): FetchPeriodTransactionsOptions {
  return {
    supabase,
    select: "id, amount",
    start: "2026-01-01",
    end: "2027-01-01",
    order,
  } as unknown as FetchPeriodTransactionsOptions;
}

describe("fetchPeriodTransactions ordering (stable offset pagination)", () => {
  it("always applies a unique id tiebreaker, even when `order` is omitted", async () => {
    const { supabase, orderCalls } = recordingClient();
    await fetchPeriodTransactions(optsFor(supabase));
    // Without this, a >1000-row period paginates unordered → rows skipped/duplicated across pages.
    expect(orderCalls).toContain("id");
  });

  it("keeps transaction_date as the primary display sort with an id tiebreaker when ordered", async () => {
    const { supabase, orderCalls } = recordingClient();
    await fetchPeriodTransactions(optsFor(supabase, "asc"));
    expect(orderCalls).toEqual(["transaction_date", "id"]);
  });
});
