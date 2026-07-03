import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fetchChangedTransactionIds } from "./transaction-history";

// C8: the transaction_history table is OPERATOR-applied AFTER this code merges + deploys. Until then
// the table does not exist, so the fetch MUST be fail-soft: any error (esp. relation-does-not-exist /
// 42P01) returns an EMPTY Set and NEVER throws — otherwise the Month-Close / Tax-Close pages break
// pre-migration.

type FakeResult = { data: unknown; error: unknown };

/**
 * Minimal fake of the exact chain fetchChangedTransactionIds uses:
 *   supabase.from(t).select(cols).order(col).range(a, b)  -> awaitable { data, error }
 * The shared makeFakeSupabase never returns errors, so we hand-roll one that can.
 */
function makeClient(result: FakeResult) {
  const query = {
    select() {
      return this;
    },
    order() {
      return this;
    },
    range() {
      return this;
    },
    then(resolve: (v: FakeResult) => unknown, reject: (e: unknown) => unknown) {
      return Promise.resolve()
        .then(() => result)
        .then(resolve, reject);
    },
  };
  return { from: () => query } as never;
}

describe("fetchChangedTransactionIds (FAIL-SOFT)", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("table absent (relation-does-not-exist error) -> empty Set, does NOT throw", async () => {
    const supabase = makeClient({
      data: null,
      error: { code: "42P01", message: 'relation "transaction_history" does not exist' },
    });
    const out = await fetchChangedTransactionIds(supabase);
    expect(out).toBeInstanceOf(Set);
    expect(out.size).toBe(0);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  test("any other query error -> empty Set, does NOT throw", async () => {
    const supabase = makeClient({ data: null, error: { message: "boom" } });
    const out = await fetchChangedTransactionIds(supabase);
    expect(out.size).toBe(0);
  });

  test("a thrown exception mid-query -> empty Set, does NOT throw", async () => {
    const supabase = {
      from() {
        throw new Error("network down");
      },
    } as never;
    const out = await fetchChangedTransactionIds(supabase);
    expect(out.size).toBe(0);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  test("present table with rows -> Set contains the transaction ids (deduped)", async () => {
    const supabase = makeClient({
      data: [
        { transaction_id: "t1" },
        { transaction_id: "t2" },
        { transaction_id: "t1" }, // duplicate (same txn changed twice) collapses in the Set
      ],
      error: null,
    });
    const out = await fetchChangedTransactionIds(supabase);
    expect(out.has("t1")).toBe(true);
    expect(out.has("t2")).toBe(true);
    expect(out.size).toBe(2);
  });

  test("present but empty table -> empty Set (and does not warn)", async () => {
    const supabase = makeClient({ data: [], error: null });
    const out = await fetchChangedTransactionIds(supabase);
    expect(out.size).toBe(0);
    expect(console.warn).not.toHaveBeenCalled();
  });
});
