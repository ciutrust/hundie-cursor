import { describe, expect, test } from "vitest";
import {
  deriveCutoverDate,
  isBackdatedCutover,
  newestPlaidSourcedDate,
  shouldPersistCutover,
} from "@/lib/plaid/cutover";
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

describe("C5 — isBackdatedCutover (would re-pull a Plaid-covered window)", () => {
  test("equal dates → true (cutover on the newest Plaid row re-pulls it)", () => {
    expect(isBackdatedCutover("2026-06-30", "2026-06-30")).toBe(true);
  });
  test("cutover earlier than newest Plaid row → true", () => {
    expect(isBackdatedCutover("2026-06-15", "2026-06-30")).toBe(true);
  });
  test("cutover later than newest Plaid row → false (no overlap)", () => {
    expect(isBackdatedCutover("2026-07-05", "2026-06-30")).toBe(false);
  });
  test("null cutover → false", () => {
    expect(isBackdatedCutover(null, "2026-06-30")).toBe(false);
  });
  test("null newestPlaidDate → false (no Plaid rows to overlap)", () => {
    expect(isBackdatedCutover("2026-06-15", null)).toBe(false);
  });
  test("both null → false", () => {
    expect(isBackdatedCutover(null, null)).toBe(false);
  });
});

describe("C5 — newestPlaidSourcedDate", () => {
  test("returns MAX(transaction_date) over Plaid-sourced rows only (external_id NOT NULL)", async () => {
    const sb: any = makeFakeSupabase({
      transactions: [
        { id: "t1", account_id: "acct-1", transaction_date: "2026-06-10", external_id: "ext-1" },
        { id: "t2", account_id: "acct-1", transaction_date: "2026-06-30", external_id: "ext-2" },
        // CSV rows (external_id NULL) must be ignored even though they are newer.
        { id: "t3", account_id: "acct-1", transaction_date: "2026-07-15", external_id: null },
      ],
    });
    expect(await newestPlaidSourcedDate(sb, ["acct-1"])).toBe("2026-06-30");
  });
  test("returns null when the accounts have no Plaid-sourced rows (only CSV rows)", async () => {
    const sb: any = makeFakeSupabase({
      transactions: [
        { id: "t1", account_id: "acct-1", transaction_date: "2026-07-15", external_id: null },
      ],
    });
    expect(await newestPlaidSourcedDate(sb, ["acct-1"])).toBeNull();
  });
  test("returns null for an empty account id list", async () => {
    const sb: any = makeFakeSupabase({ transactions: [] });
    expect(await newestPlaidSourcedDate(sb, [])).toBeNull();
  });
});

// The map-accounts POST route composes shouldPersistCutover + isBackdatedCutover(newestPlaidSourcedDate)
// + !force to decide whether to refuse a backdated override before mutating. The route itself is a
// Route Handler gated by SSR auth + MFA step-up (not reachable by the fake harness), so this exercises
// the exact composed decision the route runs, against a seeded Plaid-sourced row, for the brief's cases.
describe("C5 — map-accounts backdated-cutover refusal (composed guard against the ledger)", () => {
  async function wouldRefuse(
    sb: any,
    accountIds: string[],
    cutoverDate: string | null,
    existingLinkCount: number,
    force: boolean,
  ): Promise<boolean> {
    if (!shouldPersistCutover(existingLinkCount, cutoverDate)) return false;
    const newest = await newestPlaidSourcedDate(sb, accountIds);
    return isBackdatedCutover(cutoverDate, newest) && !force;
  }

  function seed() {
    return makeFakeSupabase({
      transactions: [
        // A Plaid-sourced row (external_id set) at 2026-06-30 for the mapped account.
        { id: "p1", account_id: "acct-1", transaction_date: "2026-06-30", external_id: "ext-1" },
        // A CSV row (external_id NULL) that must be ignored by the Plaid-only newest lookup.
        { id: "c1", account_id: "acct-1", transaction_date: "2026-07-20", external_id: null },
      ],
    });
  }

  test("backdated override (2026-06-15) on first mapping, no force → refuse", async () => {
    const sb: any = seed();
    expect(await wouldRefuse(sb, ["acct-1"], "2026-06-15", 0, false)).toBe(true);
  });

  test("same backdated override with force:true → proceed", async () => {
    const sb: any = seed();
    expect(await wouldRefuse(sb, ["acct-1"], "2026-06-15", 0, true)).toBe(false);
  });

  test("forward cutover (2026-07-05, after newest Plaid row) → proceed (no overlap)", async () => {
    const sb: any = seed();
    expect(await wouldRefuse(sb, ["acct-1"], "2026-07-05", 0, false)).toBe(false);
  });

  test("re-map (links already exist) never refuses — established cutover is untouched", async () => {
    const sb: any = seed();
    expect(await wouldRefuse(sb, ["acct-1"], "2026-06-15", 2, false)).toBe(false);
  });

  test("newest Plaid lookup ignores CSV rows — a cutover after the newest Plaid row (not the newest CSV row) proceeds", async () => {
    const sb: any = seed();
    // 2026-07-01 is after the Plaid row (06-30) but before the CSV row (07-20); must NOT refuse.
    expect(await wouldRefuse(sb, ["acct-1"], "2026-07-01", 0, false)).toBe(false);
  });
});
