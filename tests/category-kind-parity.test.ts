import { describe, expect, it } from "vitest";
import {
  categoryKind as categoryKindTs,
  CATEGORY_KIND_PATH_SETS as PATH_SETS_TS,
} from "@/lib/category-kind";
import {
  categoryKind as categoryKindMjs,
  CATEGORY_KIND_PATH_SETS as PATH_SETS_MJS,
} from "../scripts/lib/category-kind.mjs";

// PARITY GUARD: lib/category-kind.ts and scripts/lib/category-kind.mjs are two hand-copied
// mirrors (the QB import .mjs scripts run under plain `node` and cannot import the .ts). They must
// classify identically. Each file's own test only covers its side, and the .ts seeded-paths test
// excludes INCOME_PATHS — so a path added/removed/moved on only ONE side could ship a wrong-kind
// DB mis-stamp past green CI (proven in the Batch E review). This test compares the two structurally
// and behaviorally so ANY drift (add, edit, move, remove) fails CI.

const KINDS = [
  "transfer",
  "funding",
  "capital",
  "liability",
  "non_deductible",
  "income",
] as const;

const sorted = (xs: readonly string[]) => [...xs].sort();

describe("category-kind parity — .ts ↔ .mjs", () => {
  it("exports the same kind buckets on both sides", () => {
    expect(sorted(Object.keys(PATH_SETS_TS))).toEqual(sorted(Object.keys(PATH_SETS_MJS)));
    // and both cover exactly the non-default kinds we expect
    expect(sorted(Object.keys(PATH_SETS_TS))).toEqual(sorted([...KINDS]));
  });

  it("has deep-equal path members per kind (order-independent)", () => {
    for (const kind of KINDS) {
      expect(sorted(PATH_SETS_TS[kind]), `mismatch in kind "${kind}"`).toEqual(
        sorted(PATH_SETS_MJS[kind]),
      );
    }
  });

  it("classifies every known path identically on both sides", () => {
    const allPaths = new Set<string>();
    for (const kind of KINDS) {
      for (const p of PATH_SETS_TS[kind]) allPaths.add(p);
      for (const p of PATH_SETS_MJS[kind]) allPaths.add(p);
    }
    for (const path of allPaths) {
      expect(categoryKindTs(path), `divergent kind for path "${path}"`).toBe(
        categoryKindMjs(path),
      );
    }
  });

  it("agrees on shared edge cases (default expense, empty/whitespace, normalize)", () => {
    const edgeCases: (string | null | undefined)[] = [
      "Office supplies", // default → expense
      null,
      undefined,
      "",
      "   ", // whitespace-only → unclassified
      "  Credit   card  payment  ", // irregular internal whitespace → normalize → transfer
    ];
    for (const input of edgeCases) {
      expect(categoryKindTs(input), `divergent kind for input ${JSON.stringify(input)}`).toBe(
        categoryKindMjs(input),
      );
    }
  });
});
