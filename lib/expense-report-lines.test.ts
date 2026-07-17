import { describe, expect, it } from "vitest";
import {
  buildExpenseReportLines,
  pendingCardCaptures,
  sumExpenseReportLines,
  type MemberCapture,
  type MemberTransaction,
} from "./expense-report-lines";

function txn(over: Partial<MemberTransaction> = {}): MemberTransaction {
  return {
    id: "t1",
    transaction_date: "2026-03-16",
    description: "SQ *XXXX 4471",
    vendor: null,
    amount: 47,
    account_name: "Amex Alex Personal",
    notes: null,
    expensed_at: null,
    ...over,
  };
}

function capture(over: Partial<MemberCapture> = {}): MemberCapture {
  return {
    id: "c1",
    captured_at: "2026-03-14T19:20:00Z",
    vendor: "Chipotle",
    amount: 47,
    note: "Dinner with the team",
    capture_kind: "card",
    match_status: "unmatched",
    matched_transaction_id: null,
    photo_path: "u/2026-03/c1.jpg",
    photo_status: "uploaded",
    latitude: 30.2672,
    longitude: -97.7431,
    expensed_at: null,
    ...over,
  };
}

describe("buildExpenseReportLines — the suppression rule", () => {
  it("suppresses a capture whose twin IS a counted member here, and enriches that charge", () => {
    const lines = buildExpenseReportLines(
      [txn({ id: "t1" })],
      [capture({ id: "c1", matched_transaction_id: "t1", match_status: "matched" })],
    );

    // One line, not two: this is the $94 double-count prevented.
    expect(lines).toHaveLength(1);
    expect(lines[0].kind).toBe("transaction");
    expect(sumExpenseReportLines(lines).total).toBe(47);
    // The receipt rides along on the charge instead of beside it.
    expect(lines[0].enrichedBy?.captureId).toBe("c1");
    expect(lines[0].enrichedBy?.photoPath).toBe("u/2026-03/c1.jpg");
  });

  it("keeps a capture standing when its twin is NOT a member of this report", () => {
    // Reconciled, but the charge lives in another report (or none). Suppressing here would make this
    // report silently file $47 SHORT — the bug the naive "matched => hide" rule caused.
    const lines = buildExpenseReportLines(
      [],
      [capture({ matched_transaction_id: "t-elsewhere", match_status: "matched" })],
    );

    expect(lines).toHaveLength(1);
    expect(lines[0].kind).toBe("capture");
    expect(sumExpenseReportLines(lines).total).toBe(47);
  });

  it("self-heals: pulling the charge out of the report brings its capture back as a line", () => {
    const matched = capture({ matched_transaction_id: "t1", match_status: "matched" });

    const withCharge = buildExpenseReportLines([txn({ id: "t1" })], [matched]);
    expect(withCharge).toHaveLength(1);
    expect(sumExpenseReportLines(withCharge).total).toBe(47);

    // Charge removed from the report => it is no longer a counted member => capture reappears.
    const withoutCharge = buildExpenseReportLines([], [matched]);
    expect(withoutCharge).toHaveLength(1);
    expect(withoutCharge[0].kind).toBe("capture");
    // Money reappears rather than vanishing.
    expect(sumExpenseReportLines(withoutCharge).total).toBe(47);
  });

  it("treats a Plaid-reversed twin like any non-member (the fetcher drops it, capture stands)", () => {
    // The fetcher never passes a reversed charge in `transactions`, so from here it simply isn't a
    // counted member. The capture must still count, or the trip loses $47.
    const lines = buildExpenseReportLines(
      [],
      [capture({ matched_transaction_id: "t-reversed", match_status: "matched" })],
    );
    expect(lines).toHaveLength(1);
    expect(sumExpenseReportLines(lines).total).toBe(47);
  });

  it("never counts a spend twice even if two captures point at one charge", () => {
    // The partial unique index makes this unreachable, but the builder must not double-count if it
    // ever sees it (the bills bug: one charge confirmed against two obligations).
    const lines = buildExpenseReportLines(
      [txn({ id: "t1" })],
      [
        capture({ id: "c1", matched_transaction_id: "t1", match_status: "matched" }),
        capture({ id: "c2", matched_transaction_id: "t1", match_status: "matched" }),
      ],
    );
    expect(lines).toHaveLength(1);
    expect(sumExpenseReportLines(lines).total).toBe(47);
  });

  it("always keeps a cash capture as its own line — there is no charge coming", () => {
    const lines = buildExpenseReportLines(
      [txn({ id: "t1", amount: 100 })],
      [capture({ id: "cash1", capture_kind: "cash", match_status: "cash", amount: 40, vendor: "Taxi" })],
    );

    expect(lines).toHaveLength(2);
    expect(sumExpenseReportLines(lines).total).toBe(140);
    const cashLine = lines.find((l) => l.id === "cash1");
    expect(cashLine?.sublabel).toBe("Cash");
  });

  it("labels an unreconciled card capture as awaiting its charge", () => {
    const lines = buildExpenseReportLines([], [capture()]);
    expect(lines[0].sublabel).toBe("Card · awaiting charge");
  });

  it("contributes 0 for a photo-only capture with no amount yet, not NaN", () => {
    const lines = buildExpenseReportLines([], [capture({ amount: null })]);
    expect(lines[0].amount).toBe(0);
    expect(sumExpenseReportLines(lines).total).toBe(0);
  });

  it("sorts newest first with a stable id tiebreaker", () => {
    const lines = buildExpenseReportLines(
      [txn({ id: "b", transaction_date: "2026-03-10" }), txn({ id: "a", transaction_date: "2026-03-12" })],
      [capture({ id: "c", captured_at: "2026-03-11T10:00:00Z", matched_transaction_id: null })],
    );
    expect(lines.map((l) => l.id)).toEqual(["a", "c", "b"]);
  });
});

describe("sumExpenseReportLines — both numbers", () => {
  it("reports the trip total and how much of it is filed", () => {
    const lines = buildExpenseReportLines(
      [
        txn({ id: "t1", amount: 100, expensed_at: "2026-03-20T00:00:00Z" }),
        txn({ id: "t2", amount: 60 }),
      ],
      [capture({ id: "c1", capture_kind: "cash", amount: 40, expensed_at: "2026-03-20T00:00:00Z" })],
    );

    const totals = sumExpenseReportLines(lines);
    // Trip total never moves as he toggles.
    expect(totals.total).toBe(200);
    expect(totals.expensedTotal).toBe(140);
    expect(totals.expensedCount).toBe(2);
    expect(totals.count).toBe(3);
  });

  it("nets a refund down instead of inflating the trip", () => {
    const lines = buildExpenseReportLines(
      [txn({ id: "t1", amount: 100 }), txn({ id: "t2", amount: -30, description: "Refund" })],
      [],
    );
    expect(sumExpenseReportLines(lines).total).toBe(70);
  });

  it("is zero for an empty report", () => {
    expect(sumExpenseReportLines([])).toEqual({
      total: 0,
      expensedTotal: 0,
      expensedCount: 0,
      count: 0,
    });
  });
});

describe("pendingCardCaptures", () => {
  it("finds card captures still waiting on a charge (the double-count warning source)", () => {
    const lines = buildExpenseReportLines(
      [txn({ id: "t1" })],
      [
        capture({ id: "waiting", matched_transaction_id: null }),
        capture({ id: "cash1", capture_kind: "cash", match_status: "cash" }),
        capture({ id: "done", matched_transaction_id: "t1", match_status: "matched" }),
      ],
    );

    const pending = pendingCardCaptures(lines);
    expect(pending.map((l) => l.id)).toEqual(["waiting"]);
  });
});
