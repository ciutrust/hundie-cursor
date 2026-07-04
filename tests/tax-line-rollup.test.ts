import { describe, expect, test } from "vitest";
import {
  buildTaxLineRollup,
  taxLineRollupToCsv,
  type TaxRollupInput,
} from "../lib/queries/reports";

const row = (over: Partial<TaxRollupInput>): TaxRollupInput => ({
  amount: 100,
  categoryPath: "GBSL expense",
  taxForm: "sch_c",
  taxLine: "Line 8 · Advertising",
  ...over,
});

// #6 — the CPA-packet grouping + its exclusions.
describe("buildTaxLineRollup", () => {
  test("groups by (tax_form, tax_line, category) and sums amount + count", () => {
    const r = buildTaxLineRollup([
      row({ amount: 100 }),
      row({ amount: 50 }),
      row({ amount: 25, categoryPath: "GBSL other", taxLine: "Line 9 · Car" }),
    ]);
    expect(r.sections).toHaveLength(2);
    const ads = r.sections.find((s) => s.taxLine === "Line 8 · Advertising");
    expect(ads).toMatchObject({ count: 2, amount: 150, taxForm: "sch_c" });
    expect(r.review).toHaveLength(0);
    expect(r.excludedCount).toBe(0);
    expect(r.totalTxns).toBe(3);
  });

  test("tax_form='none' rows are excluded from sections and counted separately", () => {
    const r = buildTaxLineRollup([
      row({ taxForm: "sch_c" }),
      row({ taxForm: "none", taxLine: null, categoryPath: "Owner draw" }),
      row({ taxForm: "none", taxLine: null, categoryPath: "Transfer" }),
    ]);
    expect(r.sections).toHaveLength(1);
    expect(r.excludedCount).toBe(2);
    expect(r.review).toHaveLength(0);
  });

  test("unclassified (no category) AND mapped-but-no-tax-line rows fall to the CPA-review section", () => {
    const r = buildTaxLineRollup([
      row({ categoryPath: null, taxForm: null, taxLine: null, amount: 40 }), // unclassified
      row({ categoryPath: null, taxForm: null, taxLine: null, amount: 60 }), // unclassified
      row({ categoryPath: "GBSL misc", taxForm: null, taxLine: null, amount: 30 }), // category w/o tax mapping
      row({ categoryPath: "GBSL half", taxForm: "sch_c", taxLine: null, amount: 20 }), // form but no line
    ]);
    expect(r.sections).toHaveLength(0);
    const unclassified = r.review.find((x) => x.category === "Unclassified");
    expect(unclassified).toMatchObject({ count: 2, amount: 100 });
    expect(r.review.map((x) => x.category)).toContain("GBSL misc");
    expect(r.review.map((x) => x.category)).toContain("GBSL half");
  });

  test("sections are ordered by form (Sch C, E, A, forms) then line then category", () => {
    const r = buildTaxLineRollup([
      row({ taxForm: "sch_a", taxLine: "L1", categoryPath: "A" }),
      row({ taxForm: "sch_c", taxLine: "L1", categoryPath: "C" }),
      row({ taxForm: "sch_e", taxLine: "L1", categoryPath: "E" }),
    ]);
    expect(r.sections.map((s) => s.taxForm)).toEqual(["sch_c", "sch_e", "sch_a"]);
  });

  test("review section is ordered by absolute amount, largest first", () => {
    const r = buildTaxLineRollup([
      row({ categoryPath: "Small", taxForm: null, taxLine: null, amount: 10 }),
      row({ categoryPath: "Big", taxForm: null, taxLine: null, amount: -500 }),
    ]);
    expect(r.review.map((x) => x.category)).toEqual(["Big", "Small"]);
  });
});

describe("taxLineRollupToCsv", () => {
  test("emits section rows with human form labels, then review + excluded rows", () => {
    const rollup = buildTaxLineRollup([
      row({ taxForm: "sch_c", taxLine: "Line 8", categoryPath: "Ads", amount: 100 }),
      row({ categoryPath: null, taxForm: null, taxLine: null, amount: 40 }),
      row({ taxForm: "none", taxLine: null, categoryPath: "Draw" }),
    ]);
    const csv = taxLineRollupToCsv(rollup);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("tax_form,tax_line,category,num_transactions,amount");
    expect(csv).toContain("Schedule C,Line 8,Ads,1,100.00");
    expect(csv).toContain("Needs CPA review,,Unclassified,1,40.00");
    expect(csv).toContain("Excluded (personal / non-deductible),,,1,");
  });
});
