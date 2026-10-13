import { describe, expect, it } from "vitest";
import {
  liabilityErrorNeedsConsent,
  matchLiabilities,
  type LiabilityRow,
  type PlaidLiability,
} from "@/lib/plaid/match-liabilities";

const rows: LiabilityRow[] = [
  { id: "wr", type: "mortgage", name: "Chase Mortgage — Winding Ridge", plaidAccountId: null },
  { id: "heloc", type: "heloc", name: "First Financial HELOC — Winding Ridge", plaidAccountId: null },
  { id: "jt", type: "mortgage", name: "M&T Bank Mortgage — Joshua Tree", plaidAccountId: null },
  { id: "anita", type: "mortgage", name: "SPS Servicing — Anita", plaidAccountId: null },
  { id: "fair", type: "mortgage", name: "Shellpoint — Fair Meadows", plaidAccountId: null },
  { id: "ford", type: "auto_loan", name: "Ford Loan — F150 Lightning", plaidAccountId: null },
];

function plaid(partial: Partial<PlaidLiability> & Pick<PlaidLiability, "accountId" | "name">): PlaidLiability {
  return {
    mask: null,
    institution: "",
    kind: "mortgage",
    balance: 100,
    apr: 3,
    ...partial,
  };
}

describe("matchLiabilities", () => {
  it("pairs each mortgage by institution and leaves the others alone", () => {
    const incoming = [
      plaid({ accountId: "c1", institution: "Chase", name: "Mortgage", balance: 470000, apr: 2.625 }),
      plaid({ accountId: "m1", institution: "M&T Bank", name: "Home Loan", balance: 225000, apr: 3 }),
      plaid({
        accountId: "s1",
        institution: "Select Portfolio Servicing",
        name: "Mortgage",
        balance: 220000,
        apr: 7,
      }),
      plaid({ accountId: "h1", institution: "Shellpoint", name: "Mortgage", balance: 225000, apr: 7 }),
    ];
    const { matched, unmatched } = matchLiabilities(rows, incoming);
    expect(unmatched).toEqual([]);
    expect(Object.fromEntries(matched.map((m) => [m.rowId, m.plaid.accountId]))).toEqual({
      wr: "c1",
      jt: "m1",
      anita: "s1",
      fair: "h1",
    });
  });

  it("matches a HELOC only when Plaid says it is a home-equity line", () => {
    const { matched, unmatched } = matchLiabilities(rows, [
      plaid({
        accountId: "h",
        institution: "First Financial",
        name: "Home Equity Line of Credit",
        kind: "credit",
        balance: 100000,
        apr: 7.5,
      }),
    ]);
    expect(unmatched).toEqual([]);
    expect(matched.map((m) => m.rowId)).toEqual(["heloc"]);
  });

  it("does not guess between two cards at the same bank", () => {
    const cards: LiabilityRow[] = [
      { id: "a", type: "credit_card", name: "Chase Sapphire", plaidAccountId: null },
      { id: "b", type: "credit_card", name: "Chase Freedom", plaidAccountId: null },
    ];
    const { matched, unmatched } = matchLiabilities(cards, [
      plaid({ accountId: "1", institution: "Chase", name: "CREDIT CARD", kind: "credit", mask: "1111" }),
      plaid({ accountId: "2", institution: "Chase", name: "CREDIT CARD", kind: "credit", mask: "2222" }),
    ]);
    expect(matched).toEqual([]);
    expect(unmatched).toHaveLength(2);
  });

  it("keeps an existing plaid account id even if the name would not match", () => {
    const linked: LiabilityRow[] = [
      { id: "wr", type: "mortgage", name: "Winding Ridge", plaidAccountId: "already" },
    ];
    const { matched } = matchLiabilities(linked, [
      plaid({ accountId: "already", institution: "Something Else", name: "Loan", balance: 12 }),
    ]);
    expect(matched).toHaveLength(1);
    expect(matched[0]?.rowId).toBe("wr");
  });

  it("never matches a student loan onto a seeded row", () => {
    const { matched, unmatched } = matchLiabilities(rows, [
      plaid({ accountId: "stu", institution: "Chase", name: "Student Loan", kind: "student" }),
    ]);
    expect(matched).toEqual([]);
    expect(unmatched).toHaveLength(1);
  });
});

describe("liabilityErrorNeedsConsent", () => {
  it("flags a missing product and ignores a not-ready retry", () => {
    expect(liabilityErrorNeedsConsent("ADDITIONAL_CONSENT_REQUIRED: liabilities")).toBe(true);
    expect(liabilityErrorNeedsConsent("PRODUCT_NOT_READY: still initializing")).toBe(false);
  });
});
