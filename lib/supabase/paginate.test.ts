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
