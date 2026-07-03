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
 * The shared makeFakeSupabase never returns errors, so we hand-roll one that can. `.range()` is a
 * no-op here (single-page fixtures) — the multi-page paging fixture uses makePagingClient below.
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

/**
 * A paging fake that HONORS `.range(from, to)` over a fixed dataset, so a fixture larger than one
 * page exercises the >PAGE_SIZE continuation loop. Rows carry a unique `id` (the pagination key).
 */
function makePagingClient(rows: Array<{ id: string; transaction_id: string }>) {
  function build() {
    let range: [number, number] = [0, rows.length];
    const q = {
      select() {
        return q;
      },
      order() {
        return q;
      },
      range(a: number, b: number) {
        range = [a, b];
        return q;
      },
      then(resolve: (v: FakeResult) => unknown, reject: (e: unknown) => unknown) {
        return Promise.resolve()
          .then(() => ({ data: rows.slice(range[0], range[1] + 1), error: null }))
          .then(resolve, reject);
      },
    };
    return q;
  }
  return { from: () => build() } as never;
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
        // A transaction edited twice has TWO history rows (unique `id`) sharing one transaction_id;
        // the Set collapses them. Ordering/paging is now by the unique `id`, not transaction_id.
        { id: "h1", transaction_id: "t1" },
        { id: "h2", transaction_id: "t2" },
        { id: "h3", transaction_id: "t1" },
      ],
      error: null,
    });
    const out = await fetchChangedTransactionIds(supabase);
    expect(out.has("t1")).toBe(true);
    expect(out.has("t2")).toBe(true);
    expect(out.size).toBe(2);
  });

  test("a trail larger than one page is fully paged (loop terminates, all ids collected)", async () => {
    // PAGE_SIZE is 1000; seed 2300 rows across 3 pages. Every transaction_id is distinct, so a
    // dropped/duplicated page would change the count — proving the >1000-row continuation works and
    // the unique-id ordering keeps offset pagination stable (F-min1 / F-min3).
    const N = 2300;
    const rows = Array.from({ length: N }, (_, i) => ({
      id: `h${String(i).padStart(5, "0")}`, // unique, lexically sortable pagination key
      transaction_id: `t${i}`,
    }));
    const out = await fetchChangedTransactionIds(makePagingClient(rows));
    expect(out.size).toBe(N);
    expect(out.has("t0")).toBe(true);
    expect(out.has("t1500")).toBe(true); // a row only reachable on page 2
    expect(out.has(`t${N - 1}`)).toBe(true); // the very last row (page 3)
    expect(console.warn).not.toHaveBeenCalled();
  });

  test("present but empty table -> empty Set (and does not warn)", async () => {
    const supabase = makeClient({ data: [], error: null });
    const out = await fetchChangedTransactionIds(supabase);
    expect(out.size).toBe(0);
    expect(console.warn).not.toHaveBeenCalled();
  });
});
