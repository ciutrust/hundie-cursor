import { describe, expect, test } from "vitest";
import {
  EMPTY_TRANSACTION_FILTERS,
  filterTransactions,
  transactionVendorKey,
} from "../lib/transaction-filters";
import type { TransactionWithDetails } from "../lib/types/database";

const tx = (id: string, description: string, vendor: string | null = description) =>
  ({ id, description, vendor }) as unknown as TransactionWithDetails;

describe("transactionVendorKey", () => {
  test("same merchant with different reference numbers -> same key", () => {
    expect(transactionVendorKey(tx("1", "TXU ENERGY 123456"))).toBe(
      transactionVendorKey(tx("2", "TXU ENERGY 999999")),
    );
  });

  test("different merchants -> different keys", () => {
    expect(transactionVendorKey(tx("1", "TXU ENERGY 123456"))).not.toBe(
      transactionVendorKey(tx("2", "RELIANT ENERGY 123456")),
    );
  });
});

describe("filterTransactions: similarVendorKey (Find similar)", () => {
  test("keeps only same-vendor rows; without the filter all rows pass", () => {
    const rows = [
      tx("a", "TXU ENERGY 123456"),
      tx("b", "TXU ENERGY 789012"),
      tx("c", "CHASE MORTGAGE 555555"),
    ];
    const key = transactionVendorKey(rows[0]);

    const filtered = filterTransactions(rows, {
      ...EMPTY_TRANSACTION_FILTERS,
      similarVendorKey: key,
    });
    expect(filtered.map((r) => r.id).sort()).toEqual(["a", "b"]);

    // sanity: no filter keeps everything (proves the filter is what narrows it)
    expect(filterTransactions(rows, EMPTY_TRANSACTION_FILTERS)).toHaveLength(3);
  });
});
