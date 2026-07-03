import { describe, expect, test } from "vitest";
import { deriveCutoverDate, shouldPersistCutover } from "@/lib/plaid/cutover";
import { makeFakeSupabase } from "./helpers/fake-supabase.mjs";

describe("C3 — Plaid cutover derivation", () => {
  test("returns MAX(transaction_date)+1 across the mapped accounts", async () => {
    const sb: any = makeFakeSupabase({
      transactions: [
        { id: "t1", account_id: "acct-1", transaction_date: "2026-06-10" },
        { id: "t2", account_id: "acct-1", transaction_date: "2026-06-30" },
        { id: "t3", account_id: "acct-2", transaction_date: "2026-05-01" },
      ],
    });
    expect(await deriveCutoverDate(sb, ["acct-1", "acct-2"])).toBe("2026-07-01");
  });
  test("returns null when no ledger rows exist (run-sync null-guard then applies)", async () => {
    const sb: any = makeFakeSupabase({ transactions: [] });
    expect(await deriveCutoverDate(sb, ["acct-1"])).toBeNull();
  });
  test("crosses a month boundary", async () => {
    const sb: any = makeFakeSupabase({
      transactions: [{ id: "t1", account_id: "acct-1", transaction_date: "2026-01-31" }],
    });
    expect(await deriveCutoverDate(sb, ["acct-1"])).toBe("2026-02-01");
  });
});

describe("C3 — shouldPersistCutover", () => {
  test("persists on the first-ever mapping (no existing links) when a cutover was computed", () => {
    expect(shouldPersistCutover(0, "2026-07-01")).toBe(true);
  });
  test("does not persist on a re-map (links already exist) — preserves the established cutover", () => {
    expect(shouldPersistCutover(2, "2026-07-01")).toBe(false);
  });
  test("does not persist when no cutover could be computed", () => {
    expect(shouldPersistCutover(0, null)).toBe(false);
  });
});
