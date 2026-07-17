import { describe, expect, it } from "vitest";
import { scoreBillMatch } from "@/lib/bills/match";
import {
  AMBIGUITY_MARGIN,
  MIN_CAPTURE_MATCH_SCORE,
  confidentCaptureMatch,
  rankCaptureMatches,
  scoreCaptureMatch,
  vendorBonus,
  type CaptureLike,
  type ChargeLike,
} from "./match";

/** The motivating case: a receipt AC snapped, and the opaque charge that shows up 2 days later. */
const CHIPOTLE: CaptureLike = { vendor: "Chipotle", amount: 18.42, captured_at: "2026-03-14T19:20:00Z" };
const SQ_CHARGE: ChargeLike = {
  id: "t-sq",
  vendor: null,
  description: "SQ *XXXX 4471",
  amount: 22.1, // 18.42 + a 20% tip, added after the receipt printed
  transaction_date: "2026-03-16",
};

describe("the case this exists for: opaque descriptor + tip", () => {
  it("matches Chipotle $18.42 to 'SQ *XXXX 4471' $22.10 two days later", () => {
    const scored = scoreCaptureMatch(CHIPOTLE, SQ_CHARGE);
    expect(scored).not.toBeNull();
    expect(scored!.score).toBeGreaterThanOrEqual(MIN_CAPTURE_MATCH_SCORE);
    expect(scored!.vendorScore).toBe(0); // zero vendor signal, and it STILL matches
    expect(scored!.deltaDays).toBe(2);
    expect(scored!.tipRatio).toBeCloseTo(0.2, 2);
  });

  it("PROVES the inversion was necessary: the bills matcher rejects this outright", () => {
    // scoreBillMatch gates on shared vendor tokens; "chipotle" vs "sq xxxx" shares none, so it
    // returns null — it would reject the exact charge we need to identify.
    const asBill = scoreBillMatch({
      bill: { match_hint: "Chipotle", name: "Chipotle", expected_amount: 18.42, amount_varies: false },
      instance: { due_date: "2026-03-14", expected_amount: 18.42 },
      txn: {
        vendor: SQ_CHARGE.vendor,
        description: SQ_CHARGE.description,
        amount: SQ_CHARGE.amount,
        transaction_date: SQ_CHARGE.transaction_date,
      },
    });
    expect(asBill).toBeNull();
  });
});

describe("amount: asymmetric, tip-aware", () => {
  it("scores an exact amount highest", () => {
    const exact = scoreCaptureMatch(CHIPOTLE, { ...SQ_CHARGE, amount: 18.42 });
    expect(exact!.amountScore).toBe(1);
    expect(exact!.tipRatio).toBe(0);
  });

  it("accepts the whole tip band up to 30%", () => {
    for (const pct of [0.05, 0.15, 0.2, 0.3]) {
      const amount = Number((18.42 * (1 + pct)).toFixed(2));
      expect(scoreCaptureMatch(CHIPOTLE, { ...SQ_CHARGE, amount })).not.toBeNull();
    }
  });

  it("rejects a charge more than 30% over the receipt (a different spend, not a tip)", () => {
    expect(scoreCaptureMatch(CHIPOTLE, { ...SQ_CHARGE, amount: 30 })).toBeNull();
  });

  it("rejects a charge BELOW the receipt — the tip only ever adds", () => {
    expect(scoreCaptureMatch(CHIPOTLE, { ...SQ_CHARGE, amount: 15 })).toBeNull();
  });

  it("tolerates a couple cents of rounding under the receipt", () => {
    expect(scoreCaptureMatch(CHIPOTLE, { ...SQ_CHARGE, amount: 18.41 })).not.toBeNull();
  });

  it("never matches a refund", () => {
    expect(scoreCaptureMatch(CHIPOTLE, { ...SQ_CHARGE, amount: -22.1 })).toBeNull();
  });
});

describe("date: asymmetric, the charge follows the receipt", () => {
  it("accepts same-day through 5 days after", () => {
    for (const date of ["2026-03-14", "2026-03-16", "2026-03-19"]) {
      expect(scoreCaptureMatch(CHIPOTLE, { ...SQ_CHARGE, transaction_date: date })).not.toBeNull();
    }
  });

  it("rejects a charge that posted BEFORE the receipt", () => {
    expect(scoreCaptureMatch(CHIPOTLE, { ...SQ_CHARGE, transaction_date: "2026-03-13" })).toBeNull();
  });

  it("rejects a charge more than 5 days later", () => {
    expect(scoreCaptureMatch(CHIPOTLE, { ...SQ_CHARGE, transaction_date: "2026-03-21" })).toBeNull();
  });

  it("scores a closer charge higher", () => {
    const near = scoreCaptureMatch(CHIPOTLE, { ...SQ_CHARGE, transaction_date: "2026-03-14" })!;
    const far = scoreCaptureMatch(CHIPOTLE, { ...SQ_CHARGE, transaction_date: "2026-03-19" })!;
    expect(near.dateScore).toBeGreaterThan(far.dateScore);
  });
});

describe("vendor: a bonus, never a gate", () => {
  it("gives zero — not a rejection — when the descriptor shares nothing", () => {
    expect(vendorBonus("Chipotle", SQ_CHARGE)).toBe(0);
  });

  it("rewards a readable descriptor", () => {
    const readable: ChargeLike = { ...SQ_CHARGE, description: "CHIPOTLE 2894 AUSTIN TX" };
    expect(vendorBonus("Chipotle", readable)).toBeGreaterThan(0);
    // and that lifts the total score above the opaque one
    expect(scoreCaptureMatch(CHIPOTLE, readable)!.score).toBeGreaterThan(
      scoreCaptureMatch(CHIPOTLE, SQ_CHARGE)!.score,
    );
  });

  it("gives zero when the capture has no vendor typed at all", () => {
    expect(vendorBonus(null, SQ_CHARGE)).toBe(0);
    expect(scoreCaptureMatch({ ...CHIPOTLE, vendor: null }, SQ_CHARGE)).not.toBeNull();
  });
});

describe("rankCaptureMatches", () => {
  const other: ChargeLike = {
    id: "t-other",
    vendor: null,
    description: "SQ *YYYY 9911",
    amount: 21.5,
    transaction_date: "2026-03-16",
  };

  it("ranks best first", () => {
    const ranked = rankCaptureMatches(CHIPOTLE, [other, SQ_CHARGE]);
    expect(ranked.length).toBeGreaterThan(1);
    expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[1].score);
  });

  it("excludes charges already backing another capture", () => {
    const ranked = rankCaptureMatches(CHIPOTLE, [SQ_CHARGE, other], {
      excludeTransactionIds: new Set(["t-sq"]),
    });
    expect(ranked.map((r) => r.transactionId)).not.toContain("t-sq");
  });

  it("drops charges below the floor", () => {
    const nope: ChargeLike = { ...SQ_CHARGE, id: "t-nope", amount: 500 };
    expect(rankCaptureMatches(CHIPOTLE, [nope])).toEqual([]);
  });
});

describe("confidentCaptureMatch — refuses to guess", () => {
  it("returns the top match when it clearly wins", () => {
    const ranked = rankCaptureMatches(CHIPOTLE, [SQ_CHARGE]);
    expect(confidentCaptureMatch(ranked)?.transactionId).toBe("t-sq");
  });

  it("returns null when two charges are too close to call", () => {
    // Two near-identical dinners in the tip band: a silent wrong match would corrupt the report and
    // he'd never notice, so we make him pick.
    const twin: ChargeLike = { ...SQ_CHARGE, id: "t-twin", amount: 22.11 };
    const ranked = rankCaptureMatches(CHIPOTLE, [SQ_CHARGE, twin]);
    expect(ranked).toHaveLength(2);
    expect(ranked[0].score - ranked[1].score).toBeLessThan(AMBIGUITY_MARGIN);
    expect(confidentCaptureMatch(ranked)).toBeNull();
  });

  it("returns null when nothing matched", () => {
    expect(confidentCaptureMatch([])).toBeNull();
  });
});
