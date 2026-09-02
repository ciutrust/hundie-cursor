import { describe, expect, it } from "vitest";
import * as driftModule from "../scripts/lib/qb-drift.mjs";

// Plain-node module: TypeScript infers narrow types from its default parameters (e.g. `never[]`),
// which fight the fixtures. Treat the exports as untyped functions here.
type AnyFn = (...args: any[]) => any;
const { analyzeDrift, pairRows, parsePeriodText, parseQboDriftRows, qboCategoryKind, resolveSplitLines } =
  driftModule as unknown as Record<string, AnyFn>;

const HEADER = [
  "Gracie Barra Southlake,,,,,,,,",
  "Transaction Detail by Account,,,,,,,,",
  '"January 1-September 2, 2026",,,,,,,,',
  "",
  ",Transaction date,Transaction type,Num,Name,Description,Split,Amount,Balance",
].join("\n");

function csv(body: string[]) {
  return `${HEADER}\n${body.join("\n")}\n,,,,,,,,\n"Accrual Basis Wednesday, September 02, 2026 01:27 AM GMT-05:00",,,,,,,,\n`;
}

const CHECKING = "Navigate Business Checking℠ (3196) - 1";

type H = {
  id: string;
  date: string;
  amount: number;
  description: string;
  vendor: string;
  accountSlug: string;
  accountName?: string;
  category: string | null;
  kind?: string;
  isSplitLeg?: boolean;
};

function h(partial: Partial<H> & { id: string; date: string; amount: number }): H {
  return {
    description: "",
    vendor: "",
    accountSlug: "wf-gbsl-checking",
    category: "Contract Labor",
    ...partial,
  };
}

const CHART = [
  { full_path: "Contract Labor", kind: "expense", is_active: true },
  { full_path: "Meals (50%)", kind: "expense", is_active: true },
  { full_path: "Meals & Entertainment", kind: "expense", is_active: true },
  { full_path: "Membership Income", kind: "income", is_active: true },
  { full_path: "Interest income", kind: "income", is_active: true },
  { full_path: "Interest Expense", kind: "expense", is_active: true },
  { full_path: "Postage", kind: "expense", is_active: true },
  { full_path: "Ask My Accountant", kind: "expense", is_active: true },
  { full_path: "Credit card payment", kind: "transfer", is_active: true },
];

describe("parsePeriodText", () => {
  it("parses a shared-year range", () => {
    expect(parsePeriodText("January 1-September 2, 2026")).toEqual({ from: "2026-01-01", to: "2026-09-02" });
  });
  it("parses an explicit two-year range", () => {
    expect(parsePeriodText("December 1, 2025 - January 31, 2026")).toEqual({ from: "2025-12-01", to: "2026-01-31" });
  });
  it("returns null for junk", () => {
    expect(parsePeriodText("All Dates")).toBeNull();
  });
});

describe("parseQboDriftRows", () => {
  const text = csv([
    `${CHECKING},,,,,,,,`,
    ",01/02/2026,Expense,,Rosana,ZELLE TO CLEANING LADY ROSA,Contract Labor,-200.00,-200.00",
    ',01/02/2026,Deposit,,Merchant Bankcd Deposit,MERCHANT BANKCD DEPOSIT,Membership Income,"1,476.51",...',
    ",01/11/2026,Expense,,ALEX,CNB BANK TRANSFER LOAN,BHG Loan,-4622.43,...",
    ',01/12/2026,Expense,,ALEX CIUNCIUSKY,CNB BANK TRANSFER 011226 LOAN PAYMENT,,"-5,810.04",...',
    ",01/12/2026,Expense,,ALEX CIUNCIUSKY,SAME DAY SAME PAYEE DECOY,Contract Labor,-50.00,...",
    ",01/15/2026,Expense,,Mystery,NO LINES ANYWHERE,,-99.00,...",
    ",01/20/2026,Expense,,Capital One,BUSINESS TO BUSINESS ACH CAPITAL ONE,Capital One,-2000.00,...",
    ",06/16/2026,Credit Card Payment,,Claudia WF 1576,ONLINE TRANSFER,Claudia's WF Business 1576 (was 8363),-2740.43,...",
    ",02/01/2026,Journal Entry,,,,Contract Labor,-5.00,...",
    `Total for ${CHECKING},,,,,,,,`,
    "Capital One,,,,,,,,",
    ",01/10/2026,Expense,,Tiffs Treats,TIFF'S TREATS - 6754,Meals & Entertainment,34.49,...",
    ",01/08/2026,Credit Card Credit,,Kiosk,KIOSK DALSPECCTR - 6754,Travel,-265.00,...",
    `,01/20/2026,Expense,,Capital One,BUSINESS TO BUSINESS ACH CAPITAL ONE,${CHECKING},-2000.00,...`,
    "Total for Capital One,,,,,,,,",
    "BHG Loan,,,,,,,,",
    `,01/11/2026,Expense,,ALEX,CNB BANK TRANSFER LOAN,${CHECKING},-4622.43,...`,
    `,01/12/2026,Expense,,ALEX CIUNCIUSKY,CNB BANK TRANSFER 011226 LOAN PAYMENT,${CHECKING},"-4,622.43",...`,
    "Total for BHG Loan,,,,,,,,",
    "Interest Expense,,,,,,,,",
    `,01/12/2026,Expense,,ALEX CIUNCIUSKY,,${CHECKING},"1,187.61",...`,
    "Total for Interest Expense,,,,,,,,",
    "Contract Labor,,,,,,,,",
    `,01/12/2026,Expense,,ALEX CIUNCIUSKY,SAME DAY SAME PAYEE DECOY,${CHECKING},50.00,...`,
    "Total for Contract Labor,,,,,,,,",
    "Meals & Entertainment,,,,,,,,",
    ",01/10/2026,Expense,,Tiffs Treats,TIFF'S TREATS - 6754,Capital One,34.49,...",
    "Total for Meals & Entertainment,,,,,,,,",
    "Amex Business 9999,,,,,,,,",
    ",01/11/2026,Expense,,Some Vendor,SOMETHING,Travel,10.00,...",
    "Total for Amex Business 9999,,,,,,,,",
  ]);
  const parsed = parseQboDriftRows(text, { hundieCategories: CHART });
  const byKey = Object.fromEntries(parsed.rows.map((r: any) => [`${r.date}|${r.category}`, r]));

  it("reads meta: period, basis, unmapped payment sections", () => {
    expect(parsed.meta.period).toEqual({ from: "2026-01-01", to: "2026-09-02" });
    expect(parsed.meta.basis).toBe("Accrual");
    expect(parsed.meta.unmappedPaymentSections).toContain("BHG Loan");
    expect(parsed.meta.unmappedPaymentSections).toContain("Amex Business 9999");
  });

  it("normalizes signs: checking expenses positive, deposits negative; card charges positive, credits negative", () => {
    expect(byKey["2026-01-02|Contract Labor"].amount).toBe(200);
    expect(byKey["2026-01-02|Membership Income"].amount).toBe(-1476.51);
    expect(byKey["2026-01-10|Meals & Entertainment"].amount).toBe(34.49);
    expect(byKey["2026-01-08|Travel"].amount).toBe(-265);
  });

  it("keeps loan paydowns as liability rows", () => {
    expect(byKey["2026-01-11|BHG Loan"].kind).toBe("liability");
    expect(byKey["2026-01-11|BHG Loan"].amount).toBe(4622.43);
  });

  it("recovers a multi-line transaction from the category sections, ignoring a same-day decoy", () => {
    const lines = parsed.rows.filter((r: any) => r.date === "2026-01-12" && r.splitLine);
    expect(lines).toHaveLength(2);
    expect(lines.map((r: any) => [r.category, r.amount, r.kind]).sort()).toEqual([
      ["BHG Loan", 4622.43, "liability"],
      ["Interest Expense", 1187.61, "expense"],
    ]);
    const decoy = parsed.rows.find((r: any) => r.description === "SAME DAY SAME PAYEE DECOY")!;
    expect(decoy).toMatchObject({ category: "Contract Labor", amount: 50 });
    expect(decoy.splitLine).toBeUndefined();
  });

  it("keeps an unresolvable blank-split row as unclassified and counts it", () => {
    const mystery = parsed.rows.find((r: any) => r.name === "Mystery")!;
    expect(mystery.category).toBeNull();
    expect(mystery.kind).toBe("unclassified");
    expect(parsed.meta.dropped.unresolvedSplits).toBe(1);
  });

  it("keeps one copy of an own-account movement (asset side) as a transfer and drops the mirror", () => {
    const capOnePayment = parsed.rows.filter((r: any) => r.category === "Capital One");
    expect(capOnePayment).toHaveLength(1);
    expect(capOnePayment[0]).toMatchObject({ section: CHECKING, kind: "transfer", ownTransfer: true, amount: 2000 });
    const ccPayment = parsed.rows.find((r: any) => r.type === "Credit Card Payment");
    expect(ccPayment).toMatchObject({ kind: "transfer", amount: 2740.43 });
    expect(parsed.meta.dropped.ownTransferMirror.rows).toBe(1);
  });

  it("drops other types and mirror sections, counting everything", () => {
    expect(parsed.meta.dropped.otherType["Journal Entry"]).toBe(1);
    expect(parsed.rows.filter((r: any) => r.section === "Meals & Entertainment")).toHaveLength(0);
    expect(parsed.meta.dropped.unmappedSectionRows).toBe(6);
    // 2 checking + 1 loan + 2 split lines + 1 decoy + 1 unresolved + 2 transfers + 2 card = 11
    expect(parsed.rows).toHaveLength(11);
  });

  it("types sections before the first income section as balance-sheet accounts, ahead of the Hundie chart", () => {
    const text2 = csv([
      `${CHECKING},,,,,,,,`,
      ",06/25/2026,Expense,,Ford Motor Credit,FORD CREDIT PAYMENT,Ford Motor Credit - F150,-2393.68,...",
      ",06/26/2026,Expense,,Ally,ALLY PAYMT,Ford Focus,-280.02,...",
      `Total for ${CHECKING},,,,,,,,`,
      "Visa 0577,,,,,,,,",
      ",06/27/2026,Credit Card Payment,,Alex,PERSONAL FUNDS,Owners Equity:Owner Contributions,-1500.00,...",
      "Total for Visa 0577,,,,,,,,",
      "Ford Focus,,,,,,,,",
      `,06/26/2026,Expense,,Ally,ALLY PAYMT,${CHECKING},-280.02,...`,
      "Total for Ford Focus,,,,,,,,",
      "Ford Motor Credit - F150,,,,,,,,",
      `,06/25/2026,Expense,,Ford Motor Credit,FORD CREDIT PAYMENT,${CHECKING},-2393.68,...`,
      "Total for Ford Motor Credit - F150,,,,,,,,",
      "Membership Income,,,,,,,,",
      "Total for Membership Income,,,,,,,,",
      "Meals & Entertainment,,,,,,,,",
      "Total for Meals & Entertainment,,,,,,,,",
    ]);
    const chartWithFord = [...CHART, { full_path: "Ford Motor Credit - F150", kind: "expense", is_active: true }, { full_path: "Ford Focus", kind: "expense", is_active: true }];
    const p2 = parseQboDriftRows(text2, { hundieCategories: chartWithFord });
    expect(p2.meta.balanceSheetSections).toEqual(["Ford Focus", "Ford Motor Credit - F150"]);
    const byCat = Object.fromEntries(p2.rows.map((r: any) => [r.category, r]));
    expect(byCat["Ford Motor Credit - F150"]).toMatchObject({ kind: "liability", amount: 2393.68 });
    expect(byCat["Ford Focus"].kind).toBe("liability");
    // A card payment funded from personal money is a funding row, not an own-account transfer.
    expect(byCat["Owners Equity:Owner Contributions"]).toMatchObject({ kind: "funding", amount: -1500, type: "Credit Card Payment" });
    expect(byCat["Owners Equity:Owner Contributions"].ownTransfer).toBeUndefined();
  });

  it("resolveSplitLines needs at least two lines and prefers memo matches", () => {
    expect(resolveSplitLines([{ amount: 5, memoMatches: true }], 5)).toBeNull();
    const picked = resolveSplitLines(
      [{ amount: 3, memoMatches: false, tag: "a" }, { amount: 2, memoMatches: true, tag: "b" }, { amount: 3, memoMatches: true, tag: "c" }],
      5,
    );
    expect(picked.map((x: any) => x.tag)).toEqual(["b", "c"]);
  });

  it("kinds: income via Hundie chart, review, funding/income/cash back by name", () => {
    expect(qboCategoryKind("Membership Income")).toBe("income");
    expect(qboCategoryKind("Ask My Accountant")).toBe("review");
    expect(qboCategoryKind("Owners Equity:Owner Contributions")).toBe("funding");
    expect(qboCategoryKind("Cash Back Credit")).toBe("transfer");
    expect(qboCategoryKind("Uniforms")).toBe("expense");
  });
});

function qbo(partial: any) {
  return {
    source: "qbo",
    section: CHECKING,
    accountSlug: "wf-gbsl-checking",
    type: "Expense",
    name: "",
    description: "",
    category: "Contract Labor",
    kind: "expense",
    ...partial,
  };
}

describe("pairRows", () => {
  it("pairs one-to-one: two identical Hundie rows, one QBO row → one pair", () => {
    const hs = [h({ id: "h1", date: "2026-03-02", amount: 200 }), h({ id: "h2", date: "2026-03-02", amount: 200 })];
    const qs = [qbo({ id: "q1", date: "2026-03-02", amount: 200 })];
    const { pairs } = pairRows(hs, qs, { dateSlack: 5 });
    expect(pairs).toHaveLength(1);
  });

  it("never pairs a refund with a charge (signed amounts)", () => {
    const hs = [h({ id: "charge", date: "2026-03-02", amount: 50 }), h({ id: "refund", date: "2026-03-02", amount: -50 })];
    const qs = [qbo({ id: "q-refund", date: "2026-03-02", amount: -50 }), qbo({ id: "q-charge", date: "2026-03-02", amount: 50 })];
    const { pairs } = pairRows(hs, qs);
    expect(pairs.map((p: any) => [p.h.id, p.q.id]).sort()).toEqual([["charge", "q-charge"], ["refund", "q-refund"]]);
  });

  it("respects date slack and prefers the closer date", () => {
    const hs = [h({ id: "h1", date: "2026-03-05", amount: 99 })];
    const qs = [qbo({ id: "far", date: "2026-03-01", amount: 99 }), qbo({ id: "near", date: "2026-03-04", amount: 99 }), qbo({ id: "out", date: "2026-03-20", amount: 99 })];
    const { pairs } = pairRows(hs, qs, { dateSlack: 5 });
    expect(pairs[0].q.id).toBe("near");
  });

  it("cross-account pairs need a shared vendor word; same account does not", () => {
    const personalCard = h({ id: "h1", date: "2026-03-02", amount: 34.49, accountSlug: "amex-alex-personal", description: "TIFFS TREATS SOUTHLAKE", vendor: "TIFFS TREATS" });
    const noWords = h({ id: "h2", date: "2026-03-02", amount: 34.49, accountSlug: "amex-alex-personal", description: "PURCHASE", vendor: "" });
    const q = qbo({ id: "q1", date: "2026-03-02", amount: 34.49, section: "Capital One", accountSlug: "cap-one-quicksilver-claudia", name: "Tiffs Treats", description: "TIFF'S TREATS - 6754", category: "Meals & Entertainment" });
    expect(pairRows([noWords], [q]).pairs).toHaveLength(0);
    const { pairs } = pairRows([personalCard], [q]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].sameAccount).toBe(false);
    expect(pairs[0].confidence).toBe("medium");
    const sameAcc = h({ id: "h3", date: "2026-03-02", amount: 34.49, accountSlug: "cap-one-quicksilver-claudia", description: "PURCHASE", vendor: "" });
    expect(pairRows([sameAcc], [q]).pairs).toHaveLength(1);
  });

  it("prefers the same-account candidate over a cross-account one with words", () => {
    const hs = [h({ id: "same", date: "2026-03-02", amount: 10, accountSlug: "wf-gbsl-checking", description: "ZELLE TO GB MELISSA" })];
    const qs = [
      qbo({ id: "qCross", date: "2026-03-02", amount: 10, section: "Capital One", accountSlug: "cap-one-quicksilver-claudia", name: "Melissa", description: "ZELLE TO GB MELISSA" }),
      qbo({ id: "qSame", date: "2026-03-02", amount: 10, name: "Melissa", description: "ZELLE TO GB MELISSA" }),
    ];
    const { pairs } = pairRows(hs, qs);
    expect(pairs[0].q.id).toBe("qSame");
  });
});

describe("analyzeDrift", () => {
  const hundieRows: H[] = [
    h({ id: "agree", date: "2026-03-02", amount: 200, description: "ZELLE TO CLEANING LADY ROSA", category: "Contract Labor" }),
    h({ id: "differ", date: "2026-03-10", amount: 34.49, accountSlug: "cap-one-quicksilver-claudia", description: "TIFFS TREATS", category: "Meals (50%)" }),
    h({ id: "kind", date: "2026-03-11", amount: 4622.43, description: "CNB BANK TRANSFER LOAN", category: "Contract Labor" }),
    h({ id: "asks", date: "2026-03-12", amount: 77, description: "SOMETHING", category: "Contract Labor" }),
    h({ id: "review", date: "2026-03-13", amount: 88, description: "UNKNOWN", category: null }),
    h({ id: "onlyH", date: "2026-03-14", amount: 15, accountSlug: "amex-alex-personal", description: "GOOGLE ADS", category: "Contract Labor" }),
    h({ id: "transfer", date: "2026-03-15", amount: 500, description: "ONLINE TRANSFER TO VISA", category: "Credit card payment" }),
    h({ id: "income", date: "2026-03-16", amount: -1000, description: "MERCHANT BANKCD DEPOSIT", category: "Membership Income" }),
    h({ id: "aprilAgree", date: "2026-04-02", amount: 300, description: "ZELLE TO GB MELISSA", category: "Contract Labor" }),
    h({ id: "aprilOnly", date: "2026-04-03", amount: 301, description: "ZELLE TO GB BRUNA ON 04/03 REF # WFCT123", vendor: "ZELLE TO GB BRUNA ON 04", category: "Contract Labor" }),
  ];
  const qboRows = [
    qbo({ id: "q-agree", date: "2026-03-02", amount: 200, name: "Rosana", description: "ZELLE TO CLEANING LADY ROSA" }),
    qbo({ id: "q-differ", date: "2026-03-10", amount: 34.49, section: "Capital One", accountSlug: "cap-one-quicksilver-claudia", name: "Tiffs Treats", description: "TIFF'S TREATS - 6754", category: "Meals & Entertainment" }),
    qbo({ id: "q-kind", date: "2026-03-11", amount: 4622.43, name: "ALEX", description: "CNB BANK TRANSFER LOAN", category: "BHG Loan", kind: "liability" }),
    qbo({ id: "q-asks", date: "2026-03-12", amount: 77, name: "X", description: "SOMETHING", category: "Ask My Accountant", kind: "review" }),
    qbo({ id: "q-review", date: "2026-03-13", amount: 88, name: "Y", description: "UNKNOWN", category: "Office Supplies" }),
    qbo({ id: "q-onlyQ", date: "2026-03-20", amount: 42, name: "Uniform Co", description: "UNIFORMS", category: "Uniforms" }),
    qbo({ id: "q-transfer", date: "2026-03-15", amount: 500, name: "Visa 0577", description: "ONLINE TRANSFER TO VISA", category: "Visa 0577", kind: "transfer", ownTransfer: true }),
    qbo({ id: "q-income", date: "2026-03-16", amount: -1000, name: "Merchant", description: "MERCHANT BANKCD DEPOSIT", category: "Membership Income", kind: "income" }),
    qbo({ id: "q-aprilAgree", date: "2026-04-02", amount: 300, name: "Melissa", description: "ZELLE TO GB MELISSA" }),
  ];
  const accounts = [
    { slug: "wf-gbsl-checking", display_name: "WF GBSL Checking", default_entity_slug: "gbsl" },
    { slug: "cap-one-quicksilver-claudia", display_name: "Cap One Claudia Quicksilver", default_entity_slug: "personal" },
    { slug: "amex-alex-personal", display_name: "Amex Alex Personal", default_entity_slug: "personal" },
  ];
  const report = analyzeDrift({ qboRows, hundieRows, hundieCategories: CHART, accounts, options: { from: "2026-01-01", to: "2026-09-02", dateSlack: 5 } });

  it("buckets every row exactly once and the totals reconcile", () => {
    expect(report.totals.buckets).toEqual({ agree: 4, differ: 1, kindDiffer: 1, qboAsks: 1, hundieReview: 1, notGbsl: 0, onlyHundie: 2, onlyQbo: 1 });
    expect(report.totals.hundie.inScope).toBe(10);
    expect(report.totals.qbo.inScope).toBe(9);
    expect(report.totals.paired).toBe(8);
    expect(report.totals.matchedAmount).toBe(200 + 34.49 + 4622.43 + 77 + 88 + 500 - 1000 + 300);
    expect(report.totals.hundie.unreachableRows).toBe(1);
    expect(report.totals.hundie.unreachableAmount).toBe(15);
  });

  it("two transfers agree even though each names the counter-account differently", () => {
    expect(report.rows.agree.some((p: any) => p.hundieCategory === "Credit card payment" && p.qboCategory === "Visa 0577")).toBe(true);
  });

  it("month scoreboard compares expense kind only and measures coverage on reachable rows", () => {
    const march = report.months.find((m: any) => m.month === "2026-03")!;
    expect(march.hundieRows).toBe(5); // agree, differ, kind, asks, onlyH
    expect(march.reachableRows).toBe(4);
    expect(march.unreachableRows).toBe(1);
    expect(march.unreachableAmount).toBe(15);
    expect(march.qboRows).toBe(4); // agree, differ, review(Office Supplies), onlyQ
    expect(march.matched).toBe(4); // agree, differ, kind, asks
    expect(march.coverage).toBe(1);
    expect(march.agree).toBe(1);
    expect(march.differ).toBe(1);
    expect(march.onlyHundieRows).toBe(0); // the Amex row is unreachable, not "not booked yet"
    expect(march.onlyQboRows).toBe(1);
    expect(march.qboBehind).toBe(false);
    const april = report.months.find((m: any) => m.month === "2026-04")!;
    expect(april.coverage).toBe(0.5);
    expect(april.onlyHundieRows).toBe(1);
    expect(april.qboBehind).toBe(false);
  });

  it("only-in-Hundie by account names the personal card and knows it is not in QBO", () => {
    // Sorted by absolute dollars, so the $301 checking row outranks the $15 personal-card row.
    expect(report.onlyHundieByAccount).toEqual([
      { accountSlug: "wf-gbsl-checking", accountName: "WF GBSL Checking", isGbslAccount: true, inQbo: true, rows: 1, amount: 301 },
      { accountSlug: "amex-alex-personal", accountName: "Amex Alex Personal", isGbslAccount: false, inQbo: false, rows: 1, amount: 15 },
    ]);
  });

  it("groups unmatched rows by vendor and category, reachable Hundie rows only", () => {
    expect(report.onlyHundiePatterns).toEqual([
      { vendor: "ZELLE TO GB BRUNA", category: "Contract Labor", kind: "expense", rows: 1, amount: 301, months: ["2026-04"], accounts: ["WF GBSL Checking"] },
    ]);
    expect(report.onlyQboPatterns).toEqual([
      { vendor: "Uniform Co", category: "Uniforms", kind: "expense", rows: 1, amount: 42, months: ["2026-03"], accounts: [CHECKING] },
    ]);
  });

  it("groups disagreement patterns by category pair then vendor (QBO payee name wins)", () => {
    expect(report.patterns).toHaveLength(1);
    expect(report.patterns[0]).toMatchObject({ hundieCategory: "Meals (50%)", qboCategory: "Meals & Entertainment", rows: 1, amount: 34.49, kind: "expense" });
    expect(report.patterns[0].vendors[0].vendor).toBe("Tiffs Treats");
    expect(report.kindPatterns[0]).toMatchObject({ hundieCategory: "Contract Labor", qboCategory: "BHG Loan", hundieKind: "expense", qboKind: "liability" });
  });

  it("qboAsks carries Hundie's answer; hundieReview carries QBO's", () => {
    expect(report.qboAsks[0]).toMatchObject({ hundieCategory: "Contract Labor", qboCategory: "Ask My Accountant" });
    expect(report.hundieReview[0]).toMatchObject({ hundieCategory: null, qboCategory: "Office Supplies" });
  });

  it("chart audit flags unused, qbo-only and name variants, and ignores transfer counter-accounts", () => {
    const byPath = Object.fromEntries(report.chart.map((c: any) => [c.path, c]));
    expect(byPath["Postage"].flags).toEqual(["unusedBoth"]);
    expect(byPath["Uniforms"].flags).toEqual(["qboOnly"]);
    expect(byPath["Meals (50%)"].flags).toEqual(["hundieOnly"]);
    expect(byPath["Credit card payment"].flags).toEqual(["hundieOnly"]);
    expect(byPath["Visa 0577"]).toBeUndefined();
    expect(byPath["Contract Labor"].flags).toEqual([]);
    expect(byPath["Contract Labor"].hundieRows).toBe(6); // agree, kind, asks, onlyH, aprilAgree, aprilOnly
    expect(byPath["Contract Labor"].qboRows).toBe(2); // q-agree, q-aprilAgree
  });

  it("expense patterns sort before non-expense ones regardless of dollars; sub-accounts sort last", () => {
    const r = analyzeDrift({
      qboRows: [
        qbo({ id: "q1", date: "2026-03-01", amount: -90000, category: "Owners Equity", kind: "funding" }),
        qbo({ id: "q2", date: "2026-03-02", amount: 10, category: "Meals & Entertainment" }),
        qbo({ id: "q3", date: "2026-03-03", amount: 500, category: "Rent Expense" }),
      ],
      hundieRows: [
        h({ id: "h1", date: "2026-03-01", amount: -90000, category: "Owners Equity:Owner Distribution", kind: "funding" }),
        h({ id: "h2", date: "2026-03-02", amount: 10, category: "Meals (50%)" }),
        h({ id: "h3", date: "2026-03-03", amount: 500, category: "Rent Expense:US Property Trust" }),
      ],
      hundieCategories: CHART,
      accounts,
    });
    expect(r.patterns.map((p: any) => [p.kind, p.refinement])).toEqual([["expense", false], ["expense", true], ["funding", true]]);
  });

  it("known aliases pair as agree and the chart marks the Hundie name as an alias", () => {
    const r = analyzeDrift({
      qboRows: [qbo({ id: "q1", date: "2026-03-01", amount: -90000, category: "Owners Equity:Owner Contributions", kind: "funding" })],
      hundieRows: [h({ id: "h1", date: "2026-03-01", amount: -90000, category: "Owner Contribution", kind: "funding" })],
      hundieCategories: [...CHART, { full_path: "Owner Contribution", kind: "funding", is_active: true }],
      accounts,
    });
    expect(r.totals.buckets.agree).toBe(1);
    expect(r.chart.find((c: any) => c.path === "Owner Contribution").flags).toEqual(["alias"]);
  });

  it("rows Hundie filed to another entity pair as notGbsl and never count as only-in-Hundie", () => {
    const r = analyzeDrift({
      qboRows: [
        qbo({ id: "q1", date: "2026-07-03", amount: 20.79, section: "Capital One", accountSlug: "cap-one-quicksilver-claudia", name: "Amazon", description: "AMAZON MKTPL", category: "Cost of Goods Sold" }),
        qbo({ id: "q2", date: "2026-07-04", amount: 9.99, section: "Capital One", accountSlug: "cap-one-quicksilver-claudia", name: "Spotify", category: "Dues & Subscriptions" }),
      ],
      hundieRows: [
        h({ id: "personalAmazon", date: "2026-07-03", amount: 20.79, accountSlug: "cap-one-quicksilver-claudia", description: "AMAZON MKTPL", category: "Groceries & household", entitySlug: "personal" } as any),
        h({ id: "unassigned", date: "2026-07-04", amount: 9.99, accountSlug: "cap-one-quicksilver-claudia", description: "SPOTIFY", category: null, entitySlug: null } as any),
        h({ id: "personalUnpaired", date: "2026-07-05", amount: 3.33, accountSlug: "cap-one-quicksilver-claudia", description: "COFFEE", category: "Dining out", entitySlug: "personal" } as any),
      ],
      hundieCategories: CHART,
      accounts: [...accounts.map((a) => ({ ...a, default_entity_name: a.default_entity_slug === "personal" ? "Personal" : a.display_name }))],
    });
    expect(r.totals.buckets).toMatchObject({ notGbsl: 1, hundieReview: 1, onlyHundie: 0, onlyQbo: 0 });
    expect(r.totals.hundie.inScope).toBe(0);
    expect(r.meta.contextRows).toBe(3);
    expect(r.meta.contextUnpaired).toBe(1);
    expect(r.notGbslPatterns[0]).toMatchObject({ hundieCategory: "Personal · Groceries & household", qboCategory: "Cost of Goods Sold", rows: 1, amount: 20.79 });
    expect(r.rows.notGbsl[0].entitySlug).toBe("personal");
  });

  it("pairs a Hundie split against the QBO whole, one pair per leg, and reconciles", () => {
    const legs = [
      h({ id: "leg-personal", date: "2026-07-02", amount: 24.89, accountSlug: "cap-one-quicksilver-claudia", description: "AMAZON", category: "Hobbies", entitySlug: "personal", isSplitLeg: true, parentId: "p1", parentAmount: 162.23 } as any),
      h({ id: "leg-janitorial", date: "2026-07-02", amount: 37.76, accountSlug: "cap-one-quicksilver-claudia", description: "AMAZON", category: "Janitorial Supplies", isSplitLeg: true, parentId: "p1", parentAmount: 162.23 } as any),
      h({ id: "leg-office", date: "2026-07-02", amount: 99.58, accountSlug: "cap-one-quicksilver-claudia", description: "AMAZON", category: "Office Supplies", isSplitLeg: true, parentId: "p1", parentAmount: 162.23 } as any),
    ];
    const whole = qbo({ id: "q-whole", date: "2026-07-02", amount: 162.23, section: "Capital One", accountSlug: "cap-one-quicksilver-claudia", name: "Amazon", description: "AMAZON ***", category: "Cost of Goods Sold" });
    const r = analyzeDrift({ qboRows: [whole], hundieRows: legs, hundieCategories: CHART, accounts });
    expect(r.totals.paired).toBe(1);
    expect(r.totals.pairedClaims).toBe(2);
    expect(r.totals.compositePairs).toBe(3);
    expect(r.totals.buckets).toMatchObject({ differ: 2, notGbsl: 1, onlyHundie: 0, onlyQbo: 0 });
    expect(r.totals.matchedAmount).toBe(162.23);
    expect(r.rows.differ.every((p: any) => p.whole?.side === "hundieSplit" && p.whole.amount === 162.23)).toBe(true);
    expect(r.rows.differ.map((p: any) => p.amount).sort()).toEqual([37.76, 99.58]);
  });

  it("pairs QBO split lines against the Hundie whole and compares each line's category", () => {
    const lines = [
      qbo({ id: "q-int", date: "2026-01-12", amount: 1187.61, name: "ALEX", description: "CNB BANK", category: "Interest Expense", splitLine: true, splitParent: { key: "k1", amount: 5810.04 } }),
      qbo({ id: "q-prin", date: "2026-01-12", amount: 4622.43, name: "ALEX", description: "CNB BANK", category: "BHG Loan", kind: "liability", splitLine: true, splitParent: { key: "k1", amount: 5810.04 } }),
    ];
    const wholeH = h({ id: "h-loan", date: "2026-01-12", amount: 5810.04, description: "CNB BANK TRANSFER LOAN PAYMENT", category: "Interest Expense" });
    const r = analyzeDrift({ qboRows: lines, hundieRows: [wholeH], hundieCategories: CHART, accounts });
    expect(r.totals.paired).toBe(2);
    expect(r.totals.pairedClaims).toBe(1);
    expect(r.totals.buckets).toMatchObject({ agree: 1, kindDiffer: 1, onlyHundie: 0, onlyQbo: 0 });
    expect(r.totals.matchedAmount).toBe(5810.04);
    expect(r.rows.kindDiffer[0]).toMatchObject({ amount: 4622.43, qboCategory: "BHG Loan", whole: { side: "qboSplit", amount: 5810.04 } });
  });

  it("flags a same-name category whose kind differs between the two charts", () => {
    const r = analyzeDrift({
      qboRows: [qbo({ id: "q1", date: "2026-06-25", amount: 2393.68, category: "Ford Motor Credit - F150", kind: "liability" })],
      hundieRows: [h({ id: "h1", date: "2026-06-25", amount: 2393.68, category: "Ford Motor Credit - F150" })],
      hundieCategories: [...CHART, { full_path: "Ford Motor Credit - F150", kind: "expense", is_active: true }],
      accounts,
    });
    expect(r.totals.buckets.agree).toBe(1);
    const row = r.chart.find((c: any) => c.path === "Ford Motor Credit - F150")!;
    expect(row.flags).toEqual(["kindMismatch"]);
    expect(row.qboKind).toBe("liability");
  });

  it("nameVariant is flagged when only case differs", () => {
    const r = analyzeDrift({
      qboRows: [qbo({ id: "q1", date: "2026-03-01", amount: -5, category: "Interest Income", kind: "income" })],
      hundieRows: [h({ id: "h1", date: "2026-03-01", amount: -5, category: "Interest income", kind: "income" })],
      hundieCategories: CHART,
      accounts,
    });
    expect(r.totals.buckets.agree).toBe(1);
    const row = r.chart.find((c: any) => c.path === "Interest income")!;
    expect(row.flags).toEqual(["nameVariant"]);
  });

  it("handles empty inputs", () => {
    expect(() => analyzeDrift({ qboRows: [], hundieRows: [], hundieCategories: [], accounts: [] })).not.toThrow();
  });
});
