import { describe, expect, it } from "vitest";
import { chooseDuplicateKeeper, groupDuplicates } from "../scripts/cleanup-ledger-duplicates.mjs";
import { buildTransactionHash, withOccurrence } from "../scripts/lib/import-hash.mjs";

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

describe("groupDuplicates — C7 genuine-charge preservation", () => {
  const h = buildTransactionHash({ accountId: "acct-1", transactionDate: "2026-06-01", amount: 5, description: "COFFEE" });
  const mk = (id, importHash, extra = {}) => ({
    id, account_id: "acct-1", transaction_date: "2026-06-01", amount: 5, description: "COFFEE",
    import_hash: importHash, external_id: null, created_at: "2026-06-25T00:00:00Z", ...extra,
  });

  it("keeps BOTH genuine same-day charges (distinct occurrence-suffixed hashes) — no duplicate group", () => {
    expect(groupDuplicates([mk("a", h), mk("b", withOccurrence(h, 1))])).toHaveLength(0);
  });
  it("does NOT collapse two distinct Plaid charges sharing a business key (distinct external_id)", () => {
    const groups = groupDuplicates([
      mk("p1", buildTransactionHash({ accountId: "acct-1", transactionDate: "2026-06-01", amount: 5, description: "COFFEE", issuerReference: "plaid-1" }), { external_id: "plaid-1" }),
      mk("p2", buildTransactionHash({ accountId: "acct-1", transactionDate: "2026-06-01", amount: 5, description: "COFFEE", issuerReference: "plaid-2" }), { external_id: "plaid-2" }),
    ]);
    expect(groups).toHaveLength(0);
  });
  it("still collapses TRUE duplicates sharing the same import_hash", () => {
    const groups = groupDuplicates([mk("keep", h), mk("del", h)]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
    expect(chooseDuplicateKeeper(groups[0]).id).toBeDefined();
  });
  it("still collapses legacy pre-hash duplicates (null import_hash) via the business-key fallback", () => {
    expect(groupDuplicates([mk("a", null), mk("b", null)])).toHaveLength(1);
  });
});
