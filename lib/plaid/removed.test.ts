import { describe, expect, test } from "vitest";
import { isPlaidRemoved } from "./removed";

// C4: a row Plaid reported removed/reversed (plaid_removed_at stamped) must be excluded from every
// report, roll-up, and backlog count. isPlaidRemoved is the pure JS-side predicate mirroring the
// `.is("plaid_removed_at", null)` SQL filter, so JS-side filtering and SQL filtering agree.
describe("isPlaidRemoved", () => {
  test("a stamped timestamp -> removed", () => {
    expect(isPlaidRemoved({ plaid_removed_at: "2026-06-28T00:00:00.000Z" })).toBe(true);
  });
  test("null -> not removed", () => {
    expect(isPlaidRemoved({ plaid_removed_at: null })).toBe(false);
  });
  test("empty string is falsy -> not removed", () => {
    expect(isPlaidRemoved({ plaid_removed_at: "" })).toBe(false);
  });
});
