import { describe, expect, it } from "vitest";
import {
  buildImportPlanFromTransactions,
  partitionRowsByExistingExternalId,
  updateTransactionsByExternalId,
} from "../scripts/lib/ledger-import.mjs";
import { makeFakeSupabase } from "./helpers/fake-supabase.mjs";

const account = {
  id: "acct-1",
  slug: "wf-checking",
  account_type: "checking",
  default_entity_id: "ent-1",
  date_rules: [],
  default_entity: { slug: "personal" },
};
const entityMap = new Map([["personal", "ent-1"]]);

describe("BUG-01 external_id threading", () => {
  it("stores Plaid externalId on the plan row and leaves CSV-style rows null", () => {
    const plan = buildImportPlanFromTransactions(
      account,
      "plaid:c1",
      [
        { transactionDate: "2026-06-01", amount: 10, description: "X", externalId: "plaid_txn_1" },
        { transactionDate: "2026-06-02", amount: 20, description: "Y" }, // no externalId
      ],
      entityMap,
    );
    expect(plan.rows[0].transaction.external_id).toBe("plaid_txn_1");
    expect(plan.rows[1].transaction.external_id).toBeNull();
  });
});

describe("BUG-01 updateTransactionsByExternalId", () => {
  it("UPDATEs the matched row in place and never inserts a duplicate", async () => {
    const sb = makeFakeSupabase({
      transactions: [
        { id: "t1", account_id: "acct-1", external_id: "plaid_txn_1", amount: 9.99, description: "OLD" },
      ],
    });
    const row = {
      transaction: {
        external_id: "plaid_txn_1",
        transaction_date: "2026-06-01",
        posted_date: "2026-06-01",
        amount: 12.5,
        description: "NEW",
        vendor: null,
        raw_category: null,
        import_hash: "h2",
      },
    };
    const { updated, unmatched } = await updateTransactionsByExternalId(sb, "acct-1", [row]);
    expect(updated).toBe(1);
    expect(unmatched).toHaveLength(0);
    expect(sb.db.transactions).toHaveLength(1); // no double-count
    expect(sb.db.transactions[0].amount).toBe(12.5); // amount/desc updated in place
    expect(sb.db.transactions[0].description).toBe("NEW");
  });

  it("returns unknown external_ids as unmatched (to be inserted) without updating", async () => {
    const sb = makeFakeSupabase({ transactions: [] });
    const row = { transaction: { external_id: "plaid_unknown", amount: 1, description: "Z" } };
    const { updated, unmatched } = await updateTransactionsByExternalId(sb, "acct-1", [row]);
    expect(updated).toBe(0);
    expect(unmatched).toEqual([row]);
  });
});

describe("BUG-01 partitionRowsByExistingExternalId", () => {
  it("routes known external_ids to existing and the rest (incl. null) to fresh", async () => {
    const sb = makeFakeSupabase({ transactions: [{ account_id: "acct-1", external_id: "known" }] });
    const mk = (external_id: string | null) => ({ transaction: { external_id } });
    const { existing, fresh } = await partitionRowsByExistingExternalId(sb, "acct-1", [
      mk("known"),
      mk("brand-new"),
      mk(null),
    ]);
    expect(existing.map((r) => r.transaction.external_id)).toEqual(["known"]);
    expect(fresh.map((r) => r.transaction.external_id)).toEqual(["brand-new", null]);
  });
});
