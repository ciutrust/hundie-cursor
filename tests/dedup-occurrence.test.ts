import { describe, expect, test } from "vitest";
import { buildTransactionHash, dedupeImportPlanRows, withOccurrence } from "../scripts/lib/import-hash.mjs";
import { filterRowsAgainstExisting } from "../scripts/lib/ledger-import.mjs";
import { makeFakeSupabase } from "./helpers/fake-supabase.mjs";

const baseHash = (issuerReference?: string) =>
  buildTransactionHash({
    accountId: "acct-1",
    transactionDate: "2026-06-01",
    amount: 5,
    description: "COFFEE",
    issuerReference,
  });

const mkRow = (importHash: string, opts: { external_id?: string | null } = {}) => ({
  transaction: {
    account_id: "acct-1",
    transaction_date: "2026-06-01",
    amount: 5,
    description: "COFFEE",
    import_hash: importHash,
    external_id: opts.external_id ?? null,
  },
});

describe("BUG-03 — occurrence-aware in-file dedup", () => {
  test("keeps BOTH genuine same-business-key CSV charges, with distinct hashes", () => {
    const { rows, skipped } = dedupeImportPlanRows("acct-1", [
      mkRow(baseHash()),
      mkRow(baseHash()), // identical identity -> previously collapsed to 1 (transaction loss)
    ]);
    expect(rows).toHaveLength(2);
    expect(skipped).toBe(0);
    expect(rows[0].transaction.import_hash).not.toBe(rows[1].transaction.import_hash);
  });

  test("is deterministic — re-running on the same file yields the same hashes (idempotent re-import)", () => {
    const run1 = dedupeImportPlanRows("acct-1", [mkRow(baseHash()), mkRow(baseHash())]);
    const run2 = dedupeImportPlanRows("acct-1", [mkRow(baseHash()), mkRow(baseHash())]);
    expect(run1.rows.map((r) => r.transaction.import_hash)).toEqual(
      run2.rows.map((r) => r.transaction.import_hash),
    );
  });

  test("distinct Plaid txns (different issuerReference -> different base hash) are left untouched", () => {
    const a = baseHash("plaid-1");
    const b = baseHash("plaid-2");
    const { rows } = dedupeImportPlanRows("acct-1", [mkRow(a), mkRow(b)]);
    expect(rows.map((r) => r.transaction.import_hash).sort()).toEqual([a, b].sort());
  });
});

describe("BUG-03 — occurrence-aware cross-batch dedup (filterRowsAgainstExisting)", () => {
  test("idempotent: re-importing the exact same (occurrence-suffixed) hashes inserts nothing", async () => {
    const occ = withOccurrence(baseHash(), 1);
    const sb = makeFakeSupabase({
      transactions: [
        { id: "t1", account_id: "acct-1", transaction_date: "2026-06-01", amount: 5, description: "COFFEE", import_hash: baseHash() },
        { id: "t2", account_id: "acct-1", transaction_date: "2026-06-01", amount: 5, description: "COFFEE", import_hash: occ },
      ],
    });
    const { rows, skipped } = await filterRowsAgainstExisting(
      sb,
      "acct-1",
      [mkRow(baseHash()), mkRow(occ)],
      "2026-06-01",
      "2026-06-01",
    );
    expect(rows).toHaveLength(0);
    expect(skipped).toBe(2);
  });

  test("inserts max(0, incoming - existing): ledger has 1, incoming has 2 -> keep the new one", async () => {
    const occ = withOccurrence(baseHash(), 1);
    const sb = makeFakeSupabase({
      transactions: [
        { id: "t1", account_id: "acct-1", transaction_date: "2026-06-01", amount: 5, description: "COFFEE", import_hash: baseHash() },
      ],
    });
    const { rows } = await filterRowsAgainstExisting(
      sb,
      "acct-1",
      [mkRow(baseHash()), mkRow(occ)],
      "2026-06-01",
      "2026-06-01",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].transaction.import_hash).toBe(occ);
  });

  test("legacy: a same-business-key row stored under a DIFFERENT hash still blocks the re-import (no dup)", async () => {
    const sb = makeFakeSupabase({
      transactions: [
        { id: "t1", account_id: "acct-1", transaction_date: "2026-06-01", amount: 5, description: "COFFEE", import_hash: "LEGACY-HASH" },
      ],
    });
    const { rows, skipped } = await filterRowsAgainstExisting(
      sb,
      "acct-1",
      [mkRow(baseHash())],
      "2026-06-01",
      "2026-06-01",
    );
    expect(rows).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  test("Plaid rows (external_id) bypass the legacy business-key budget — a genuinely-new charge is kept", async () => {
    const sb = makeFakeSupabase({
      transactions: [
        { id: "t1", account_id: "acct-1", transaction_date: "2026-06-01", amount: 5, description: "COFFEE", import_hash: "OLD" },
      ],
    });
    const fresh = mkRow(baseHash("plaid-new"), { external_id: "plaid-new" });
    const { rows } = await filterRowsAgainstExisting(sb, "acct-1", [fresh], "2026-06-01", "2026-06-01");
    expect(rows).toHaveLength(1);
  });
});

describe("BUG-05 — stable-order pagination over a >1000-row window", () => {
  test("loads the full window (no skipped keys) so a row on page 2 still dedupes", async () => {
    const transactions = [];
    for (let i = 0; i < 1001; i++) {
      transactions.push({
        id: `t${String(i).padStart(4, "0")}`,
        account_id: "acct-1",
        transaction_date: "2026-06-01",
        amount: i,
        description: `ROW${i}`,
        import_hash: `h${i}`,
      });
    }
    const sb = makeFakeSupabase({ transactions });
    const last = transactions[1000]; // lives on page 2 (offset 1000)
    const incoming = {
      transaction: {
        account_id: "acct-1",
        transaction_date: "2026-06-01",
        amount: last.amount,
        description: last.description,
        import_hash: last.import_hash,
        external_id: null,
      },
    };
    const { rows, skipped } = await filterRowsAgainstExisting(
      sb,
      "acct-1",
      [incoming],
      "2026-06-01",
      "2026-06-01",
    );
    expect(rows).toHaveLength(0); // the 1001st existing key was loaded -> exact-hash skip
    expect(skipped).toBe(1);
  });
});
