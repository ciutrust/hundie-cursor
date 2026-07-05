import { describe, expect, it } from "vitest";
import { suggestedTransactionIds, transactionVendorKey } from "./transaction-filters";
import type { TransactionWithDetails } from "@/lib/types/database";

function makeTx(
  id: string,
  description: string,
  vendor: string | null,
  categoryId: string | null,
): TransactionWithDetails {
  return {
    id,
    description,
    vendor,
    amount: 12.5,
    transaction_date: "2026-01-01",
    account: { id: "acc", display_name: "Checking", slug: "checking", account_type: "checking" },
    classification: {
      id: `c-${id}`,
      entity_id: "ent",
      category_id: categoryId,
      category: categoryId ? { id: categoryId, full_path: "Some / Cat" } : null,
      notes: null,
    },
    splits: [],
  } as unknown as TransactionWithDetails;
}

describe("suggestedTransactionIds", () => {
  it("includes an unclassified row whose vendor has an inline suggestion", () => {
    const tx = makeTx("t1", "STARBUCKS #123 AUSTIN", "Starbucks", null);
    const key = transactionVendorKey(tx);
    const ids = suggestedTransactionIds([tx], { [key]: { categoryId: "cat-1" } });
    expect(ids.has("t1")).toBe(true);
  });

  it("excludes a row whose vendor was looked up but has no match (null value)", () => {
    const tx = makeTx("t1", "STARBUCKS #123 AUSTIN", "Starbucks", null);
    const key = transactionVendorKey(tx);
    const ids = suggestedTransactionIds([tx], { [key]: null });
    expect(ids.has("t1")).toBe(false);
  });

  it("excludes a row with no suggestion loaded for its vendor", () => {
    const tx = makeTx("t1", "STARBUCKS #123 AUSTIN", "Starbucks", null);
    const ids = suggestedTransactionIds([tx], {});
    expect(ids.size).toBe(0);
  });

  it("excludes an already-classified row even if its vendor key has a suggestion", () => {
    const tx = makeTx("t1", "STARBUCKS #123 AUSTIN", "Starbucks", "cat-existing");
    const key = transactionVendorKey(tx);
    const ids = suggestedTransactionIds([tx], { [key]: { categoryId: "cat-1" } });
    expect(ids.has("t1")).toBe(false);
  });

  it("includes a row present in the AI-suggestion id set regardless of inline pill", () => {
    const tx = makeTx("t1", "SOME ONE-OFF WIRE", null, null);
    const ids = suggestedTransactionIds([tx], {}, new Set(["t1"]));
    expect(ids.has("t1")).toBe(true);
  });

  it("counts both bubble sources across a mixed list", () => {
    const withPill = makeTx("pill", "TRADER JOES 456", "Trader Joes", null);
    const withAi = makeTx("ai", "RANDOM DEPOSIT", null, null);
    const classified = makeTx("done", "TRADER JOES 456", "Trader Joes", "cat-x");
    const bare = makeTx("bare", "UNKNOWN VENDOR XYZ", null, null);
    const pillKey = transactionVendorKey(withPill);
    const ids = suggestedTransactionIds(
      [withPill, withAi, classified, bare],
      { [pillKey]: { categoryId: "cat-1" } },
      new Set(["ai"]),
    );
    expect([...ids].sort()).toEqual(["ai", "pill"]);
  });
});
