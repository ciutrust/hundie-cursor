// Typed port of the Tier-1 deterministic ranking (parallel to scripts/lib/proposal-ranking.mjs, which
// the CLI uses). Kept in sync by tests/generate-proposals.test.ts (parity assertion). Pure + dependency
// -free so the confidence thresholds are unit-tested in isolation.

/** The classifiable entities the deterministic generator runs over. Single source of truth (#3/#4). */
export const CLASSIFIABLE_SLUGS = ["gbsl", "keller", "personal", "acaa-austin", "pflugerville"] as const;

export type Confidence = "high" | "medium";

export type CategoryCount = {
  categoryId: string;
  categoryPath: string;
  count: number;
};

export type DominantCategory = {
  categoryId: string;
  categoryPath: string;
  confidence: Confidence;
  share: number;
  total: number;
  topCount: number;
};

export type DominantCategoryOptions = {
  minSamplesHigh?: number;
  highShare?: number;
  medShare?: number;
};

/**
 * Given how a vendor's prior (training) transactions were categorized, pick the dominant category +
 * a confidence. null = too ambiguous / no signal → leave for Tier-2 (Claude) analysis.
 */
export function dominantCategory(
  categoryCounts: CategoryCount[],
  opts: DominantCategoryOptions = {},
): DominantCategory | null {
  const { minSamplesHigh = 3, highShare = 0.8, medShare = 0.6 } = opts;
  const rows = (categoryCounts ?? []).filter((c) => c && c.count > 0);
  const total = rows.reduce((s, c) => s + c.count, 0);
  if (total === 0) return null;

  const sorted = [...rows].sort((a, b) => b.count - a.count);
  const top = sorted[0];
  const share = top.count / total;

  let confidence: Confidence;
  if (share >= highShare && top.count >= minSamplesHigh) confidence = "high";
  else if (share >= medShare) confidence = "medium";
  else return null; // genuinely split history → Tier 2

  return {
    categoryId: top.categoryId,
    categoryPath: top.categoryPath,
    confidence,
    share,
    total,
    topCount: top.count,
  };
}

/** Human rationale for a Tier-1 proposal. */
export function trainingRationale(result: DominantCategory | null, vendorKey: string): string {
  if (!result) return "";
  const pct = Math.round(result.share * 100);
  return `${result.topCount}/${result.total} prior "${vendorKey}" → ${result.categoryPath} (${pct}%)`;
}
