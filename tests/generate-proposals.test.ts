import { describe, expect, test } from "vitest";
import {
  buildTrainingProposals,
  excludeCommitted,
  type ProposalRow,
  type TrainingRow,
  type UnclassifiedRow,
} from "../lib/suggestions/generate-proposals";
import { dominantCategory, trainingRationale } from "../lib/suggestions/proposal-ranking";
// Parity guard: the CLI still uses the .mjs copy; assert the TS port matches so they can't diverge.
import {
  dominantCategory as mjsDominant,
  trainingRationale as mjsRationale,
} from "../scripts/lib/proposal-ranking.mjs";

const activePathById = new Map<string, string>([
  ["cat-ads", "Advertising & Marketing"],
  ["cat-fuel", "Auto Expense:Fuel"],
]);

const train = (category_id: string | null, vendor: string): TrainingRow => ({
  category_id,
  vendor_name: vendor,
  description: vendor,
});
const unclass = (transaction_id: string, vendor: string): UnclassifiedRow => ({
  transaction_id,
  description: vendor,
  vendor,
});

describe("buildTrainingProposals", () => {
  test("a consistent vendor history yields a high-confidence proposal", () => {
    const training = [
      train("cat-ads", "META ADS"),
      train("cat-ads", "META ADS"),
      train("cat-ads", "META ADS"),
      train("cat-ads", "META ADS"),
    ];
    const proposals = buildTrainingProposals({
      entityId: "e1",
      entitySlug: "gbsl",
      activePathById,
      training,
      unclassified: [unclass("t1", "META ADS")],
    });
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      transaction_id: "t1",
      entity_id: "e1",
      entity_slug: "gbsl",
      proposed_category_id: "cat-ads",
      proposed_category_path: "Advertising & Marketing",
      confidence: "high",
      source: "training",
      status: "pending",
    });
    expect(proposals[0].rationale).toContain("Advertising & Marketing");
  });

  test("a genuinely split vendor history produces no proposal (left for Tier 2)", () => {
    const training = [
      train("cat-ads", "SPLIT VENDOR"),
      train("cat-fuel", "SPLIT VENDOR"),
    ];
    const proposals = buildTrainingProposals({
      entityId: "e1",
      entitySlug: "gbsl",
      activePathById,
      training,
      unclassified: [unclass("t1", "SPLIT VENDOR")],
    });
    expect(proposals).toHaveLength(0);
  });

  test("a vendor with no training history produces no proposal", () => {
    const proposals = buildTrainingProposals({
      entityId: "e1",
      entitySlug: "gbsl",
      activePathById,
      training: [],
      unclassified: [unclass("t1", "UNKNOWN VENDOR")],
    });
    expect(proposals).toHaveLength(0);
  });

  test("training rows in an INACTIVE (unmapped) category are ignored", () => {
    const training = [
      train("cat-deleted", "GHOST"),
      train("cat-deleted", "GHOST"),
      train("cat-deleted", "GHOST"),
    ];
    const proposals = buildTrainingProposals({
      entityId: "e1",
      entitySlug: "gbsl",
      activePathById, // cat-deleted not present -> filtered
      training,
      unclassified: [unclass("t1", "GHOST")],
    });
    expect(proposals).toHaveLength(0);
  });
});

describe("excludeCommitted (critical un-commit guard)", () => {
  const rows: ProposalRow[] = [
    { transaction_id: "t1" } as ProposalRow,
    { transaction_id: "t2" } as ProposalRow,
    { transaction_id: "t3" } as ProposalRow,
  ];

  test("drops proposals whose transaction already has a committed proposal", () => {
    const out = excludeCommitted(rows, new Set(["t2"]));
    expect(out.map((r) => r.transaction_id)).toEqual(["t1", "t3"]);
  });

  test("no committed txns -> passthrough (same array ref)", () => {
    expect(excludeCommitted(rows, new Set())).toBe(rows);
  });
});

describe("proposal-ranking TS port matches the CLI .mjs (no divergence)", () => {
  const cases = [
    [
      { categoryId: "a", categoryPath: "A", count: 5 },
      { categoryId: "b", categoryPath: "B", count: 1 },
    ],
    [
      { categoryId: "a", categoryPath: "A", count: 2 },
      { categoryId: "b", categoryPath: "B", count: 2 },
    ],
    [{ categoryId: "a", categoryPath: "A", count: 2 }],
  ];

  test("dominantCategory + trainingRationale agree with the .mjs", () => {
    for (const counts of cases) {
      const ts = dominantCategory(counts);
      const mjs = mjsDominant(counts);
      expect(ts).toEqual(mjs);
      expect(trainingRationale(ts, "vk")).toEqual(mjsRationale(mjs, "vk"));
    }
  });
});
