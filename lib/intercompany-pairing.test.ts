import { describe, expect, test } from "vitest";
import { categoryKind } from "@/lib/category-kind";
import {
  categoryPairTemplate,
  extractTransferRef,
  pairCandidates,
  type PairLeg,
  suggestLinkKind,
} from "./intercompany-pairing";

const leg = (
  transactionId: string,
  accountId: string,
  entitySlug: string,
  transactionDate: string,
  amount: number,
  description = "",
): PairLeg => ({
  transactionId,
  accountId,
  entitySlug,
  transactionDate,
  amount,
  description,
  categoryId: null,
  categoryPath: null,
});

const opts = (init?: { linkedIds?: string[]; dismissedPairs?: string[] }) => ({
  linkedIds: new Set(init?.linkedIds ?? []),
  dismissedPairs: new Set(init?.dismissedPairs ?? []),
});

// The real Aug 4 Wells Fargo shapes: the SAME ref token on both legs of one transfer.
const AUG4_OUT =
  "ONLINE TRANSFER TO GBSL, LLC BUSINESS CHECKING XXXXXX3196 REF #IB0Z7NFL7H ON 08/04/26";
const AUG4_IN =
  "ONLINE TRANSFER FROM CIUNCIUSKY A PREMIER CHECKING XXXXXX1996 REF #IB0Z7NFL7H ON 08/04/26";

describe("extractTransferRef", () => {
  test("pulls the token from the online-transfer format (REF #TOKEN)", () => {
    expect(extractTransferRef(AUG4_OUT)).toBe("IB0Z7NFL7H");
    expect(extractTransferRef(AUG4_IN)).toBe("IB0Z7NFL7H");
  });

  test("pulls the token from the Zelle format with a space after the # (REF # TOKEN)", () => {
    expect(extractTransferRef("ZELLE TO AWAIS CHAUDHARY ON 08/01 REF # WFCT22H63LCJ")).toBe(
      "WFCT22H63LCJ",
    );
  });

  test("returns null when there is no ref token", () => {
    expect(extractTransferRef("MOBILE DEPOSIT ON 08/04")).toBeNull();
    expect(extractTransferRef("REFUND #ABC123XYZ")).toBeNull(); // REFUND is not REF #
    expect(extractTransferRef("REF #AB12")).toBeNull(); // too short to be a bank ref
    expect(extractTransferRef("")).toBeNull();
  });

  test("uppercases a lowercase descriptor so both legs key the same bucket", () => {
    expect(
      extractTransferRef(
        "online transfer from ciunciusky a premier checking xxxxxx1996 ref #ib0z7nfl7h on 08/04/26",
      ),
    ).toBe("IB0Z7NFL7H");
  });
});

describe("pairCandidates - tier 1 (shared ref token)", () => {
  test("real Aug 4 shape: two same-amount pairs with distinct tokens are BOTH confident", () => {
    // Same amount + same day on both pairs, so only the token can tell them apart.
    const out1 = leg("out-1", "acct-personal", "personal", "2026-08-04", 5000, AUG4_OUT);
    const in1 = leg("in-1", "acct-gbsl", "gbsl", "2026-08-04", -5000, AUG4_IN);
    const out2 = leg(
      "out-2",
      "acct-personal",
      "personal",
      "2026-08-04",
      5000,
      "ONLINE TRANSFER TO KELLER SERVICES LLC BUSINESS CHECKING XXXXXX7777 REF #IB0Z8KQM2P ON 08/04/26",
    );
    const in2 = leg(
      "in-2",
      "acct-keller",
      "keller",
      "2026-08-04",
      -5000,
      "ONLINE TRANSFER FROM CIUNCIUSKY A PREMIER CHECKING XXXXXX1996 REF #IB0Z8KQM2P ON 08/04/26",
    );

    const res = pairCandidates([out1, in1, out2, in2], opts());
    expect(res).toHaveLength(2);

    const s1 = res.find((s) => s.out.transactionId === "out-1")!;
    expect(s1.confidentInId).toBe("in-1");
    expect(s1.refToken).toBe("IB0Z7NFL7H");
    expect(s1.candidates.map((c) => c.transactionId)).toEqual(["in-1"]);
    expect(s1.kind).toBe("owner_funding");

    const s2 = res.find((s) => s.out.transactionId === "out-2")!;
    expect(s2.confidentInId).toBe("in-2");
    expect(s2.refToken).toBe("IB0Z8KQM2P");
    expect(s2.candidates.map((c) => c.transactionId)).toEqual(["in-2"]);
    expect(s2.kind).toBe("owner_funding");
  });

  test("a token bucket with 2 outs + 1 in downgrades every pairing to ambiguous", () => {
    const desc = "ONLINE TRANSFER TO GBSL, LLC BUSINESS CHECKING REF #DUPTOKEN99 ON 08/04/26";
    const out1 = leg("out-1", "acct-a", "personal", "2026-08-04", 250, desc);
    const out2 = leg("out-2", "acct-b", "personal", "2026-08-04", 250, desc);
    const in1 = leg(
      "in-1",
      "acct-c",
      "gbsl",
      "2026-08-04",
      -250,
      "ONLINE TRANSFER FROM CIUNCIUSKY A PREMIER CHECKING REF #DUPTOKEN99 ON 08/04/26",
    );

    const res = pairCandidates([out1, out2, in1], opts());
    expect(res).toHaveLength(2);
    for (const s of res) {
      expect(s.confidentInId).toBeNull();
      expect(s.refToken).toBe("DUPTOKEN99");
      expect(s.candidates.map((c) => c.transactionId)).toEqual(["in-1"]);
    }
  });

  test("a confident in-leg is consumed and NOT offered to a tokenless out (greedy 1:1)", () => {
    const out1 = leg("out-1", "acct-a", "personal", "2026-08-04", 900, AUG4_OUT);
    const in1 = leg("in-1", "acct-b", "gbsl", "2026-08-04", -900, AUG4_IN);
    // Same amount, same day, no token: without consumption this out would claim in-1 at tier 2.
    const out2 = leg("out-2", "acct-c", "personal", "2026-08-04", 900, "CHECK 1042");

    const res = pairCandidates([out1, in1, out2], opts());
    expect(res).toHaveLength(1);
    expect(res[0].out.transactionId).toBe("out-1");
    expect(res[0].confidentInId).toBe("in-1");
  });
});

describe("pairCandidates - tier 2 (amount + date window)", () => {
  test("3 same-amount candidates within ±3 days: ambiguous, sorted closest-date-first", () => {
    const out = leg("out", "acct-a", "gbsl", "2026-06-10", 1200, "TRANSFER TO SAVINGS");
    const far = leg("in-far", "acct-b", "gbsl", "2026-06-13", -1200, "TRANSFER FROM CHECKING");
    const near = leg("in-near", "acct-c", "gbsl", "2026-06-11", -1200, "TRANSFER FROM CHECKING");
    const exact = leg("in-exact", "acct-d", "gbsl", "2026-06-10", -1200, "TRANSFER FROM CHECKING");

    const res = pairCandidates([out, far, near, exact], opts());
    expect(res).toHaveLength(1);
    expect(res[0].confidentInId).toBeNull();
    expect(res[0].refToken).toBeNull();
    expect(res[0].candidates.map((c) => c.transactionId)).toEqual(["in-exact", "in-near", "in-far"]);
  });

  test("equidistant candidates keep input order (stable tie-break)", () => {
    const out = leg("out", "acct-a", "gbsl", "2026-06-10", 1200, "");
    const before = leg("in-before", "acct-b", "gbsl", "2026-06-09", -1200, "");
    const after = leg("in-after", "acct-c", "gbsl", "2026-06-11", -1200, "");

    const res = pairCandidates([out, before, after], opts());
    expect(res[0].candidates.map((c) => c.transactionId)).toEqual(["in-before", "in-after"]);
  });

  test("a single tier-2 candidate is STILL ambiguous (confidentInId null without a token)", () => {
    const out = leg("out", "acct-a", "gbsl", "2026-06-10", 1200, "TRANSFER TO SAVINGS");
    const inn = leg("in", "acct-b", "gbsl", "2026-06-10", -1200, "TRANSFER FROM CHECKING");

    const res = pairCandidates([out, inn], opts());
    expect(res).toHaveLength(1);
    expect(res[0].confidentInId).toBeNull();
  });

  test("same accountId is excluded (a transfer cannot land where it left)", () => {
    const out = leg("out", "acct-a", "gbsl", "2026-06-10", 1200, "");
    const inn = leg("in", "acct-a", "gbsl", "2026-06-10", -1200, "");
    expect(pairCandidates([out, inn], opts())).toEqual([]);
  });

  test("same entity across DIFFERENT accounts pairs (Keller between its two checkings)", () => {
    const out = leg("out", "acct-keller-1", "keller", "2026-06-10", 500, "");
    const inn = leg("in", "acct-keller-2", "keller", "2026-06-10", -500, "");

    const res = pairCandidates([out, inn], opts());
    expect(res).toHaveLength(1);
    expect(res[0].candidates.map((c) => c.transactionId)).toEqual(["in"]);
    expect(res[0].kind).toBe("internal_transfer");
  });

  test("a 4-day gap is excluded (window is ±3 days)", () => {
    const out = leg("out", "acct-a", "gbsl", "2026-06-10", 1200, "");
    const inn = leg("in", "acct-b", "gbsl", "2026-06-14", -1200, "");
    expect(pairCandidates([out, inn], opts())).toEqual([]);
  });

  test("pairs across a month boundary (May 31 out, Jun 1 in)", () => {
    const out = leg("out", "acct-a", "gbsl", "2026-05-31", 800, "");
    const inn = leg("in", "acct-b", "gbsl", "2026-06-01", -800, "");

    const res = pairCandidates([out, inn], opts());
    expect(res).toHaveLength(1);
    expect(res[0].candidates.map((c) => c.transactionId)).toEqual(["in"]);
  });
});

describe("pairCandidates - exclusions", () => {
  test("a linked in-leg is excluded, leaving the out with no suggestion", () => {
    const out = leg("out", "acct-a", "gbsl", "2026-06-10", 1200, "");
    const inn = leg("in", "acct-b", "gbsl", "2026-06-10", -1200, "");
    expect(pairCandidates([out, inn], opts({ linkedIds: ["in"] }))).toEqual([]);
  });

  test("a linked out-leg produces no suggestion at all", () => {
    const out = leg("out", "acct-a", "gbsl", "2026-06-10", 1200, "");
    const inn = leg("in", "acct-b", "gbsl", "2026-06-10", -1200, "");
    expect(pairCandidates([out, inn], opts({ linkedIds: ["out"] }))).toEqual([]);
  });

  test("dismissedPairs excludes that candidate ONLY, others stay offered", () => {
    const out = leg("out", "acct-a", "gbsl", "2026-06-10", 1200, "");
    const in1 = leg("in-1", "acct-b", "gbsl", "2026-06-10", -1200, "");
    const in2 = leg("in-2", "acct-c", "gbsl", "2026-06-11", -1200, "");

    const res = pairCandidates([out, in1, in2], opts({ dismissedPairs: ["out:in-1"] }));
    expect(res).toHaveLength(1);
    expect(res[0].candidates.map((c) => c.transactionId)).toEqual(["in-2"]);
  });
});

describe("pairCandidates - cents equality (never float)", () => {
  test("4614.10 out matches a 4614.1 in (same cents)", () => {
    const out = leg("out", "acct-a", "gbsl", "2026-06-10", 4614.1, "");
    const inn = leg("in", "acct-b", "gbsl", "2026-06-10", -4614.1, "");
    expect(pairCandidates([out, inn], opts())).toHaveLength(1);
  });

  test("float drift does not break equality (0.1 + 0.2 pairs with 0.3)", () => {
    const out = leg("out", "acct-a", "gbsl", "2026-06-10", 0.1 + 0.2, ""); // 0.30000000000000004
    const inn = leg("in", "acct-b", "gbsl", "2026-06-10", -0.3, "");
    expect(pairCandidates([out, inn], opts())).toHaveLength(1);
  });

  test("one cent apart does NOT match (4614.10 vs 4614.11)", () => {
    const out = leg("out", "acct-a", "gbsl", "2026-06-10", 4614.1, "");
    const inn = leg("in", "acct-b", "gbsl", "2026-06-10", -4614.11, "");
    expect(pairCandidates([out, inn], opts())).toEqual([]);
  });
});

describe("suggestLinkKind", () => {
  test("classifies by entity pair", () => {
    expect(suggestLinkKind("keller", "keller")).toBe("internal_transfer");
    expect(suggestLinkKind("personal", "personal")).toBe("internal_transfer"); // same slug wins
    expect(suggestLinkKind("personal", "gbsl")).toBe("owner_funding");
    expect(suggestLinkKind("gbsl", "personal")).toBe("owner_funding");
    expect(suggestLinkKind("gbsl", "acaa-austin")).toBe("intercompany_service");
    expect(suggestLinkKind("acaa-austin", "gbsl")).toBe("internal_transfer"); // reverse is not the lease
    expect(suggestLinkKind("gbsl", "keller")).toBe("internal_transfer");
  });
});

describe("categoryPairTemplate", () => {
  test("owner funding INTO a business pre-fills the funding pair", () => {
    expect(categoryPairTemplate("owner_funding", "personal", "gbsl")).toEqual({
      outPath: "Owner transfer to business",
      inPath: "Owner Contribution",
    });
  });

  test("a business -> personal draw is link-only (no template)", () => {
    expect(categoryPairTemplate("owner_funding", "gbsl", "personal")).toBeNull();
  });

  test("owner_funding with neither slug personal has no template", () => {
    expect(categoryPairTemplate("owner_funding", "gbsl", "keller")).toBeNull();
  });

  test("the GBSL -> ACAA lease pre-fills the 136 Anita pair (byte-exact em-dash paths)", () => {
    expect(categoryPairTemplate("intercompany_service", "gbsl", "acaa-austin")).toEqual({
      outPath: "Intercompany — 136 Anita",
      inPath: "Intercompany — 136 Anita (income)",
    });
  });

  test("intercompany_service for any other entity pair has no template", () => {
    expect(categoryPairTemplate("intercompany_service", "acaa-austin", "gbsl")).toBeNull();
    expect(categoryPairTemplate("intercompany_service", "gbsl", "keller")).toBeNull();
  });

  test("internal transfers pre-fill the same path on both legs", () => {
    expect(categoryPairTemplate("internal_transfer", "keller", "keller")).toEqual({
      outPath: "Internal transfer",
      inPath: "Internal transfer",
    });
  });

  test("every template path resolves off the P&L under categoryKind (kind twins wired)", () => {
    expect(categoryKind("Internal transfer")).toBe("transfer");
    expect(categoryKind("Owner transfer to business")).toBe("funding");
    expect(categoryKind("Owner Contribution")).toBe("funding");
    expect(categoryKind("Intercompany — 136 Anita (income)")).toBe("income");
    // The GBSL out leg stays a real deductible expense on GBSL's books (ACCT-07).
    expect(categoryKind("Intercompany — 136 Anita")).toBe("expense");
  });
});
