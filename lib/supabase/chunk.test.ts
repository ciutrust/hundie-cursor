import { describe, expect, it } from "vitest";
import { chunk } from "@/lib/supabase/chunk";

describe("chunk", () => {
  it("splits into consecutive sub-arrays of at most size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns a single chunk when the input is smaller than size", () => {
    expect(chunk([1, 2], 200)).toEqual([[1, 2]]);
  });

  it("returns [] for empty input", () => {
    expect(chunk([], 200)).toEqual([]);
  });

  it("defaults to 200 and loses nothing across chunks (URL-safety)", () => {
    const ids = Array.from({ length: 450 }, (_, i) => i);
    const chunks = chunk(ids);
    expect(chunks).toHaveLength(3); // 200 + 200 + 50
    expect(Math.max(...chunks.map((c) => c.length))).toBe(200);
    expect(chunks.flat()).toEqual(ids);
  });

  it("throws on size < 1", () => {
    expect(() => chunk([1], 0)).toThrow();
  });
});
