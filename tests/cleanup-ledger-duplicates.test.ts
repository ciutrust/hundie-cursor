import { describe, expect, it } from "vitest";
import { chooseDuplicateKeeper } from "../scripts/cleanup-ledger-duplicates.mjs";

describe("chooseDuplicateKeeper", () => {
  const base = {
    id: "a",
    created_at: "2026-06-25T18:14:37Z",
    classifications: [{ category_id: null, classified_by: "import" }],
  };

  it("keeps the older row when both are import-only", () => {
    const older = { ...base, id: "keep", created_at: "2026-06-25T18:14:37Z" };
    const newer = { ...base, id: "del", created_at: "2026-06-26T18:41:05Z" };
    expect(chooseDuplicateKeeper([newer, older]).id).toBe("keep");
  });

  it("keeps the categorized row", () => {
    const uncategorized = { ...base, id: "old", created_at: "2026-06-25T18:14:37Z" };
    const categorized = {
      ...base,
      id: "cat",
      created_at: "2026-06-26T18:41:05Z",
      classifications: [{ category_id: "cat-1", classified_by: "user" }],
    };
    expect(chooseDuplicateKeeper([uncategorized, categorized]).id).toBe("cat");
  });
});
