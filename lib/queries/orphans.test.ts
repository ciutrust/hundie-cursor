import { describe, expect, test } from "vitest";
import { bucketOrphansByEntityMonth, fetchOrphanCountsByEntityMonth } from "./orphans";
import { makeFakeSupabase } from "../../tests/helpers/fake-supabase.mjs";

// C9: an ORPHAN is a transactions row with NO classifications row (a classification insert failed
// mid-import). The !inner report embeds hide orphans from every report AND the backlog/close counts,
// so a month can read CLOSED with unbooked charges. The close path counts them separately.

describe("bucketOrphansByEntityMonth (pure)", () => {
  const accounts = new Map<string, { default_entity_id: string | null }>([
    ["acct-gbsl", { default_entity_id: "ent-gbsl" }],
    ["acct-personal", { default_entity_id: "ent-personal" }],
    ["acct-noentity", { default_entity_id: null }],
  ]);

  test("buckets orphans by the account's default entity and by month", () => {
    const orphans = [
      { id: "t1", account_id: "acct-gbsl", transaction_date: "2026-03-15" },
      { id: "t2", account_id: "acct-gbsl", transaction_date: "2026-03-20" },
      { id: "t3", account_id: "acct-personal", transaction_date: "2026-07-04" },
    ];
    const out = bucketOrphansByEntityMonth(orphans, accounts);
    expect(out.get("ent-gbsl")).toEqual({ 3: 2 });
    expect(out.get("ent-personal")).toEqual({ 7: 1 });
  });

  test("an account with a null default_entity_id buckets to 'unassigned' (never dropped)", () => {
    const orphans = [{ id: "t1", account_id: "acct-noentity", transaction_date: "2026-05-01" }];
    const out = bucketOrphansByEntityMonth(orphans, accounts);
    expect(out.get("unassigned")).toEqual({ 5: 1 });
  });

  test("an orphan on an unknown account (no accounts row) still buckets to 'unassigned' (never dropped)", () => {
    const orphans = [{ id: "t1", account_id: "acct-missing", transaction_date: "2026-05-01" }];
    const out = bucketOrphansByEntityMonth(orphans, accounts);
    expect(out.get("unassigned")).toEqual({ 5: 1 });
  });

  test("no orphans -> empty map", () => {
    expect(bucketOrphansByEntityMonth([], accounts).size).toBe(0);
  });
});

describe("fetchOrphanCountsByEntityMonth (fake supabase, flat selects)", () => {
  function seed() {
    return makeFakeSupabase({
      transactions: [
        // classified (has a classifications row) -> NOT an orphan
        { id: "t-classified", account_id: "acct-gbsl", transaction_date: "2026-03-10", plaid_removed_at: null },
        // orphan (no classifications row) on a GBSL account
        { id: "t-orphan-1", account_id: "acct-gbsl", transaction_date: "2026-03-11", plaid_removed_at: null },
        // orphan on a personal account, different month
        { id: "t-orphan-2", account_id: "acct-personal", transaction_date: "2026-08-02", plaid_removed_at: null },
        // orphan on an account with no default entity -> unassigned
        { id: "t-orphan-3", account_id: "acct-noentity", transaction_date: "2026-08-15", plaid_removed_at: null },
        // a REMOVED orphan -> excluded (not an orphan to book)
        { id: "t-removed", account_id: "acct-gbsl", transaction_date: "2026-03-12", plaid_removed_at: "2026-03-13T00:00:00Z" },
        // out-of-year orphan -> excluded by the year window
        { id: "t-nextyear", account_id: "acct-gbsl", transaction_date: "2027-01-05", plaid_removed_at: null },
      ],
      classifications: [{ id: "c1", transaction_id: "t-classified" }],
      accounts: [
        { id: "acct-gbsl", default_entity_id: "ent-gbsl" },
        { id: "acct-personal", default_entity_id: "ent-personal" },
        { id: "acct-noentity", default_entity_id: null },
      ],
    });
  }

  test("counts unclassified in-year rows, buckets by default entity, excludes removed + classified", async () => {
    const sb: any = seed();
    const out = await fetchOrphanCountsByEntityMonth(sb, 2026);
    expect(out.get("ent-gbsl")).toEqual({ 3: 1 }); // only t-orphan-1 (classified/removed excluded)
    expect(out.get("ent-personal")).toEqual({ 8: 1 });
    expect(out.get("unassigned")).toEqual({ 8: 1 }); // t-orphan-3, null default entity
    // the removed orphan and the next-year orphan never appear
    expect([...out.values()].reduce((s, m) => s + Object.values(m).reduce((a, b) => a + b, 0), 0)).toBe(3);
  });

  test("a year with no orphans -> empty map", async () => {
    const sb: any = makeFakeSupabase({
      transactions: [
        { id: "t1", account_id: "acct-gbsl", transaction_date: "2026-03-10", plaid_removed_at: null },
      ],
      classifications: [{ id: "c1", transaction_id: "t1" }],
      accounts: [{ id: "acct-gbsl", default_entity_id: "ent-gbsl" }],
    });
    const out = await fetchOrphanCountsByEntityMonth(sb, 2026);
    expect(out.size).toBe(0);
  });
});
