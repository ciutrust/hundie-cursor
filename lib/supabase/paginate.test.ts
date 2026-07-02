import { describe, expect, it, vi } from "vitest";
import { paginateAll } from "@/lib/supabase/paginate";

describe("paginateAll (OPT-02 truncation guard)", () => {
  it("accumulates across pages and is NOT truncated at 1000", async () => {
    const all = Array.from({ length: 2500 }, (_, i) => ({ id: i }));
    const build = vi.fn(async (from: number, pageSize: number) => ({
      data: all.slice(from, from + pageSize),
      error: null,
    }));
    const result = await paginateAll(build, 1000);
    expect(result).toHaveLength(2500);
    expect(build).toHaveBeenCalledTimes(3); // 1000,1000,500
  });

  it("stops after an exactly-full final page yields an empty page", async () => {
    const all = Array.from({ length: 2000 }, (_, i) => ({ id: i }));
    const build = vi.fn(async (from: number, pageSize: number) => ({
      data: all.slice(from, from + pageSize),
      error: null,
    }));
    const result = await paginateAll(build, 1000);
    expect(result).toHaveLength(2000);
    expect(build).toHaveBeenCalledTimes(3); // 1000,1000,0
  });

  it("throws the supabase error message", async () => {
    await expect(
      paginateAll(async () => ({ data: null, error: { message: "boom" } })),
    ).rejects.toThrow("boom");
  });
});

describe("paginateAll (stable-order guard via `key`)", () => {
  it("throws when a row key is seen on two pages (unstable pagination)", async () => {
    // Page 1 is full (forces a 2nd fetch); page 2 re-returns id 999 from page 1 — the exact
    // symptom of a missing/non-unique .order() tiebreaker.
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ id: i }));
    const page2 = [{ id: 999 }, ...Array.from({ length: 999 }, (_, i) => ({ id: 1000 + i }))];
    const pages = [page1, page2];
    let call = 0;
    const build = async () => ({ data: pages[call++] ?? [], error: null });
    await expect(paginateAll(build, 1000, (r) => r.id)).rejects.toThrow(/two pages|tiebreaker/);
  });

  it("does not throw for stable, unique pages when `key` is provided", async () => {
    const all = Array.from({ length: 2500 }, (_, i) => ({ id: i }));
    const build = async (from: number, pageSize: number) => ({
      data: all.slice(from, from + pageSize),
      error: null,
    });
    const result = await paginateAll(build, 1000, (r) => r.id);
    expect(result).toHaveLength(2500);
  });

  it("ignores duplicates when no `key` is given (back-compat)", async () => {
    const build = async () => ({ data: [{ id: 1 }, { id: 1 }], error: null });
    const result = await paginateAll(build); // single short page → ends; guard is opt-in
    expect(result).toHaveLength(2);
  });
});
