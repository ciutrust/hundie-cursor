import { describe, expect, test } from "vitest";
import { importAccountPlan } from "../scripts/lib/ledger-import.mjs";
import { buildTransactionHash } from "../scripts/lib/import-hash.mjs";
import { makeFakeSupabase } from "./helpers/fake-supabase.mjs";

const ACCOUNT = { id: "acct-1", slug: "test", display_name: "Test", default_entity_id: "ent-1" };

function planFor(importHash: string) {
  return {
    account: ACCOUNT,
    csvPath: "plaid:test",
    rows: [
      {
        transaction: {
          account_id: "acct-1",
          transaction_date: "2026-06-01",
          posted_date: "2026-06-01",
          amount: 12.34,
          description: "COFFEE SHOP",
          vendor: null,
          raw_category: null,
          import_hash: importHash,
        },
        classification: {
          entity_id: "ent-1",
          category_id: null,
          classified_by: "import",
          notes: null,
        },
        entitySlug: "personal",
      },
    ],
    dateMin: "2026-06-01",
    dateMax: "2026-06-01",
    rawRows: [],
    inFileDupes: 0,
  };
}

const hash = buildTransactionHash({
  accountId: "acct-1",
  transactionDate: "2026-06-01",
  amount: 12.34,
  description: "COFFEE SHOP",
  issuerReference: "plaid-tx-xyz",
});

describe("BUG-02 — classification self-heal over the full deduped set", () => {
  test("heals an orphaned transaction (tx exists, classification missing) even though it is filtered from the insert", async () => {
    const sb = makeFakeSupabase({
      transactions: [
        {
          id: "tx-orphan",
          account_id: "acct-1",
          transaction_date: "2026-06-01",
          amount: 12.34,
          description: "COFFEE SHOP",
          import_hash: hash,
        },
      ],
      classifications: [], // orphan: no classification
    });

    const res = await importAccountPlan(sb, planFor(hash), { storeRaw: false });

    expect(res.inserted).toBe(0); // business key already present → nothing inserted
    expect(sb.db.classifications).toHaveLength(1); // healed
    expect(sb.db.classifications[0].transaction_id).toBe("tx-orphan");
    expect(sb.db.classifications[0].entity_id).toBe("ent-1");
    // Pre-fix this was 0 — the orphan was filtered out before the heal loop.
  });

  test("re-import of a fully-classified row is idempotent and never overwrites the existing classification", async () => {
    const sb = makeFakeSupabase({
      transactions: [
        {
          id: "tx-1",
          account_id: "acct-1",
          transaction_date: "2026-06-01",
          amount: 12.34,
          description: "COFFEE SHOP",
          import_hash: hash,
        },
      ],
      classifications: [
        { id: "c-1", transaction_id: "tx-1", entity_id: "ent-human", classified_by: "user" },
      ],
    });

    const res = await importAccountPlan(sb, planFor(hash), { storeRaw: false });

    expect(res.inserted).toBe(0);
    expect(sb.db.classifications).toHaveLength(1);
    expect(sb.db.classifications[0].entity_id).toBe("ent-human"); // untouched
  });

  test("fresh row inserts the transaction and its classification", async () => {
    const sb = makeFakeSupabase({ transactions: [], classifications: [] });

    const res = await importAccountPlan(sb, planFor(hash), { storeRaw: false });

    expect(res.inserted).toBe(1);
    expect(sb.db.classifications).toHaveLength(1);
    expect(sb.db.classifications[0].entity_id).toBe("ent-1");
  });
});
