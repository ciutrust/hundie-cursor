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
  const isCalls: Array<{ col: string; val: unknown }> = [];
  const q: Record<string, unknown> = {};
  const chain = () => q;
  Object.assign(q, {
    select: chain,
    gte: chain,
    lt: chain,
    range: chain,
    eq: chain,
    is: (col: string, val: unknown) => {
      isCalls.push({ col, val });
      return q;
    },
    order: (col: string) => {
      orderCalls.push(col);
      return q;
    },
    then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
      resolve({ data: [], error: null }),
  });
  const supabase = { from: () => q };
  return { supabase, orderCalls, isCalls };
}

function optsFor(
  supabase: unknown,
  order?: "asc" | "desc",
  extra?: Partial<FetchPeriodTransactionsOptions>,
): FetchPeriodTransactionsOptions {
  return {
    supabase,
    select: "id, amount",
    start: "2026-01-01",
    end: "2027-01-01",
    order,
    ...extra,
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

// C4: reversed/removed Plaid charges (plaid_removed_at stamped) are not real spend. The shared
// fetcher opts OUT by default — every report/backlog/close caller excludes them automatically,
// eliminating the "forgot a caller" risk — and a caller must explicitly pass excludeRemoved:false
// to include them.
describe("fetchPeriodTransactions excludeRemoved (opt-out default)", () => {
  it("excludes plaid_removed_at rows by default (adds .is(plaid_removed_at, null))", async () => {
    const { supabase, isCalls } = recordingClient();
    await fetchPeriodTransactions(optsFor(supabase, "asc"));
    expect(isCalls).toContainEqual({ col: "plaid_removed_at", val: null });
  });

  it("still excludes them when excludeRemoved is undefined (default true)", async () => {
    const { supabase, isCalls } = recordingClient();
    await fetchPeriodTransactions(optsFor(supabase, "asc", { excludeRemoved: undefined }));
    expect(isCalls).toContainEqual({ col: "plaid_removed_at", val: null });
  });

  it("includes removed rows only when excludeRemoved is explicitly false", async () => {
    const { supabase, isCalls } = recordingClient();
    await fetchPeriodTransactions(optsFor(supabase, "asc", { excludeRemoved: false }));
    expect(isCalls).not.toContainEqual({ col: "plaid_removed_at", val: null });
  });
});
