import { describe, expect, test, vi } from "vitest";
import {
  collectSync,
  isMutationDuringPagination,
  MUTATION_DURING_PAGINATION,
  type SyncPage,
} from "./plaid-sync";

function page(over: Partial<SyncPage<string>>): SyncPage<string> {
  return { added: [], modified: [], removed: [], hasMore: false, nextCursor: "end", ...over };
}

describe("collectSync", () => {
  test("accumulates added/modified/removed across pages and returns the final cursor", async () => {
    const pages = [
      page({ added: ["a1"], hasMore: true, nextCursor: "c1" }),
      page({ added: ["a2"], modified: ["m1"], removed: ["r1"], hasMore: false, nextCursor: "c2" }),
    ];
    let i = 0;
    const result = await collectSync(async () => pages[i++], undefined);
    expect(result.added).toEqual(["a1", "a2"]);
    expect(result.modified).toEqual(["m1"]);
    expect(result.removed).toEqual(["r1"]);
    expect(result.cursor).toBe("c2");
  });

  test("restarts the whole loop from the original cursor on a mutation error", async () => {
    const err = { response: { data: { error_code: MUTATION_DURING_PAGINATION } } };
    const seen: (string | undefined)[] = [];
    let throwOnce = true;
    const onRestart = vi.fn();
    const result = await collectSync<string>(
      async (cursor) => {
        seen.push(cursor);
        if (cursor === "c1" && throwOnce) {
          throwOnce = false;
          throw err;
        }
        if (cursor === undefined) return page({ added: ["a1"], hasMore: true, nextCursor: "c1" });
        return page({ added: ["a2"], hasMore: false, nextCursor: "done" });
      },
      undefined,
      { onRestart },
    );
    expect(seen).toEqual([undefined, "c1", undefined, "c1"]); // restarted from ORIGINAL cursor
    expect(onRestart).toHaveBeenCalledTimes(1);
    expect(result.added).toEqual(["a1", "a2"]);
  });

  test("gives up after maxRestarts and rethrows", async () => {
    const err = { error_code: MUTATION_DURING_PAGINATION };
    await expect(
      collectSync(
        async () => {
          throw err;
        },
        undefined,
        { maxRestarts: 2 },
      ),
    ).rejects.toBe(err);
  });

  test("isMutationDuringPagination detects both error shapes", () => {
    expect(isMutationDuringPagination({ error_code: MUTATION_DURING_PAGINATION })).toBe(true);
    expect(
      isMutationDuringPagination({ response: { data: { error_code: MUTATION_DURING_PAGINATION } } }),
    ).toBe(true);
    expect(isMutationDuringPagination({ error_code: "OTHER" })).toBe(false);
  });
});
