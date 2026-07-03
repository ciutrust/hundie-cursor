import { describe, expect, test } from "vitest";
import {
  existingExternalIdsForAccount,
  ineligibleModifiedToRemove,
  resolveSyncFromDate,
  stampRemovedTransactions,
  unmappedPlaidAccountIds,
  formatPlaidDropSummaryLine,
} from "@/lib/plaid/run-sync";
import type { AggregatorTransaction } from "@/lib/aggregator";
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

// C20: a Plaid `modified` event whose new state now FAILS shouldImportPlaidTxn (e.g. re-reported as
// a card payment/transfer, or gone pending) is dropped by the eligible filter — but the STALE
// pre-modification row already sits in the ledger, overstating expenses. ineligibleModifiedToRemove
// picks the external_ids of such rows that ALSO already exist, to route them to removal-stamping.
describe("C20 — ineligibleModifiedToRemove", () => {
  function txn(overrides: Partial<AggregatorTransaction>): AggregatorTransaction {
    return {
      externalId: "ext-x",
      accountExternalId: "plaid-A",
      transactionDate: "2026-06-15",
      postedDate: "2026-06-15",
      amount: 42,
      description: "COFFEE SHOP",
      vendor: null,
      rawCategory: null,
      pending: false,
      ...overrides,
    };
  }

  test("a modified row that now fails the filter AND already exists → in the set", () => {
    // On a card account, a payment-name description now fails shouldImportPlaidTxn.
    const modified = [
      txn({ externalId: "ext-1", description: "AUTOPAY PAYMENT THANK YOU" }),
    ];
    const result = ineligibleModifiedToRemove(modified, "credit_card", new Set(["ext-1"]));
    expect(result).toEqual(["ext-1"]);
  });

  test("a modified row that now fails but was NEVER imported (not existing) → excluded (no phantom removal)", () => {
    const modified = [
      txn({ externalId: "ext-2", description: "AUTOPAY PAYMENT THANK YOU" }),
    ];
    const result = ineligibleModifiedToRemove(modified, "credit_card", new Set(["ext-1"]));
    expect(result).toEqual([]);
  });

  test("a modified row that still passes the filter → excluded even if it exists", () => {
    const modified = [txn({ externalId: "ext-1", description: "COFFEE SHOP", amount: 42 })];
    const result = ineligibleModifiedToRemove(modified, "credit_card", new Set(["ext-1"]));
    expect(result).toEqual([]);
  });

  test("account-type sensitivity: a payment-name row on a DEPOSITORY account still passes (income capture) → excluded", () => {
    const modified = [
      txn({ externalId: "ext-1", description: "ZELLE PAYMENT FROM TENANT", amount: -1200 }),
    ];
    // On checking/savings the payment-name drop must not fire, so it stays eligible → not removed.
    const result = ineligibleModifiedToRemove(modified, "checking", new Set(["ext-1"]));
    expect(result).toEqual([]);
  });

  test("returns only the existing failing ids across a mixed batch", () => {
    const modified = [
      txn({ externalId: "ext-1", description: "AUTOPAY PAYMENT THANK YOU" }), // fails + exists
      txn({ externalId: "ext-2", description: "AUTOPAY PAYMENT THANK YOU" }), // fails + NOT exists
      txn({ externalId: "ext-3", description: "COFFEE SHOP" }), // passes + exists
      txn({ externalId: "ext-4", amount: 0, description: "AUTH HOLD" }), // fails (zero) + exists
    ];
    const result = ineligibleModifiedToRemove(
      modified,
      "credit_card",
      new Set(["ext-1", "ext-3", "ext-4"]),
    );
    expect(result).toEqual(["ext-1", "ext-4"]);
  });

  // The runPlaidSync per-account loop composes existingExternalIdsForAccount (DB read) →
  // ineligibleModifiedToRemove (pure) → stampRemovedTransactions (DB write). runPlaidSync itself
  // wraps aggregator network + secret decryption (not fakeable by the flat harness), so this drives
  // that DB-side composition against a seeded ledger, mirroring exactly what the loop does.
  test("integration: a modified row flipped to payment on a card, present in the ledger, is stamped removed — and a non-existent one is not (no phantom removal)", async () => {
    const sb: any = makeFakeSupabase({
      transactions: [
        // The stale pre-modification charge already in the ledger (external_id set = Plaid-sourced).
        { id: "row-1", account_id: "acct-1", external_id: "ext-1", plaid_removed_at: null },
      ],
    });
    // Plaid re-reports ext-1 as a card PAYMENT (now ineligible) and delivers ext-2 (also a payment,
    // but never imported → must NOT be stamped).
    const modified: AggregatorTransaction[] = [
      txn({ externalId: "ext-1", description: "AUTOPAY PAYMENT THANK YOU" }),
      txn({ externalId: "ext-2", description: "AUTOPAY PAYMENT THANK YOU" }),
    ];

    const existing = await existingExternalIdsForAccount(
      sb,
      "acct-1",
      modified.map((t) => t.externalId),
    );
    const toRemove = ineligibleModifiedToRemove(modified, "credit_card", existing);
    expect(toRemove).toEqual(["ext-1"]); // ext-2 excluded — it was never imported

    const stamped = await stampRemovedTransactions(sb, ["acct-1"], toRemove, "2026-06-28T00:00:00.000Z");
    expect(stamped).toBe(1);
    expect(sb.db.transactions.find((t: any) => t.id === "row-1")!.plaid_removed_at).toBe(
      "2026-06-28T00:00:00.000Z",
    );
    // No phantom row was inserted for the never-imported ext-2.
    expect(sb.db.transactions.some((t: any) => t.external_id === "ext-2")).toBe(false);
    expect(sb.db.transactions.length).toBe(1);
  });
});

// C12: dropped Plaid rows previously left no trace. formatPlaidDropSummaryLine turns the pure
// summarizePlaidDrops() tally into the one-line, per-import log message runPlaidSync emits.
describe("C12 — formatPlaidDropSummaryLine (Plaid drop visibility)", () => {
  test("formats a summary with mixed reasons and omits zero-count reasons", () => {
    const line = formatPlaidDropSummaryLine({
      kept: 10,
      dropped: 3,
      reasons: { pending: 1, zero: 0, pfc: 0, payment: 2, card_income: 0 },
      samples: { payment: ["AUTOPAY PAYMENT THANK YOU"], pending: ["PENDING CHARGE"] },
    });
    expect(line).toContain("kept 10");
    expect(line).toContain("dropped 3");
    expect(line).toContain("payment=2");
    expect(line).toContain("pending=1");
    expect(line).not.toContain("zero=");
    expect(line).not.toContain("pfc=");
    expect(line).not.toContain("card_income=");
  });

  test("returns null when nothing was dropped (no line to log)", () => {
    const line = formatPlaidDropSummaryLine({
      kept: 5,
      dropped: 0,
      reasons: { pending: 0, zero: 0, pfc: 0, payment: 0, card_income: 0 },
      samples: {},
    });
    expect(line).toBeNull();
  });
});
