import { describe, expect, test } from "vitest";
import {
  resolveSyncFromDate,
  stampRemovedTransactions,
  unmappedPlaidAccountIds,
} from "@/lib/plaid/run-sync";
import { makeFakeSupabase } from "./helpers/fake-supabase.mjs";

describe("C2 — unmappedPlaidAccountIds (cursor-advance gate)", () => {
  const linkMap = new Map<string, string>([
    ["plaid-A", "acct-1"],
    ["plaid-B", "acct-2"],
  ]);
  test("flags an incoming Plaid account with no link", () => {
    expect(unmappedPlaidAccountIds(["plaid-A", "plaid-Z"], linkMap)).toEqual(["plaid-Z"]);
  });
  test("returns empty when every incoming account is mapped (safe to advance cursor)", () => {
    expect(unmappedPlaidAccountIds(["plaid-A", "plaid-B"], linkMap)).toEqual([]);
  });
  test("dedupes repeated unmapped ids", () => {
    expect(unmappedPlaidAccountIds(["plaid-Z", "plaid-Z"], linkMap)).toEqual(["plaid-Z"]);
  });
});

describe("BUG-06 — resolveSyncFromDate guard", () => {
  test("null falls back to today and warns (never full history)", () => {
    const r = resolveSyncFromDate(null, "2026-06-28");
    expect(r.dateFrom).toBe("2026-06-28");
    expect(r.warning).toMatch(/null/);
  });
  test("undefined falls back to today and warns", () => {
    const r = resolveSyncFromDate(undefined, "2026-06-28");
    expect(r.dateFrom).toBe("2026-06-28");
    expect(r.warning).not.toBeNull();
  });
  test("a real date passes through with no warning", () => {
    const r = resolveSyncFromDate("2026-01-01", "2026-06-28");
    expect(r.dateFrom).toBe("2026-01-01");
    expect(r.warning).toBeNull();
  });
});

describe("BUG-09 — stampRemovedTransactions", () => {
  function seed() {
    return makeFakeSupabase({
      transactions: [
        { id: "a", account_id: "acct-1", external_id: "ext-1", plaid_removed_at: null },
        { id: "b", account_id: "acct-1", external_id: "ext-2", plaid_removed_at: null },
        { id: "c", account_id: "acct-2", external_id: "ext-1", plaid_removed_at: null }, // other connection's account
      ],
    });
  }

  test("stamps only the removed id within the connection's accounts", async () => {
    const sb: any = seed();
    const n = await stampRemovedTransactions(sb, ["acct-1"], ["ext-1"], "2026-06-28T00:00:00.000Z");
    expect(n).toBe(1);
    expect(sb.db.transactions.find((t: any) => t.id === "a")!.plaid_removed_at).toBe(
      "2026-06-28T00:00:00.000Z",
    );
    expect(sb.db.transactions.find((t: any) => t.id === "b")!.plaid_removed_at).toBeNull();
    expect(sb.db.transactions.find((t: any) => t.id === "c")!.plaid_removed_at).toBeNull(); // not in acct-1
  });

  test("is idempotent — a second run stamps nothing", async () => {
    const sb: any = seed();
    await stampRemovedTransactions(sb, ["acct-1"], ["ext-1"], "2026-06-28T00:00:00.000Z");
    const n2 = await stampRemovedTransactions(sb, ["acct-1"], ["ext-1"], "2026-06-29T00:00:00.000Z");
    expect(n2).toBe(0);
    expect(sb.db.transactions.find((t: any) => t.id === "a")!.plaid_removed_at).toBe(
      "2026-06-28T00:00:00.000Z",
    );
  });

  test("no-ops on empty inputs", async () => {
    const sb: any = seed();
    expect(await stampRemovedTransactions(sb, [], ["ext-1"], "x")).toBe(0);
    expect(await stampRemovedTransactions(sb, ["acct-1"], [], "x")).toBe(0);
  });
});
