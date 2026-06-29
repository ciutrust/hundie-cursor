// Pure logic for the Tier-1 deterministic proposal generator.
// Given how a vendor's prior (training) transactions were categorized, decide the dominant
// category + a confidence. Kept pure + dependency-free so it's unit-tested in isolation.

/**
 * @param {Array<{categoryId: string, categoryPath: string, count: number}>} categoryCounts
 *        tally for ONE vendor key, ACTIVE categories only (inactive ones filtered upstream).
 * @param {{minSamplesHigh?: number, highShare?: number, medShare?: number}} [opts]
 * @returns {null | {categoryId: string, categoryPath: string, confidence: 'high'|'medium', share: number, total: number, topCount: number}}
 *          null = too ambiguous / no signal → leave for Tier-2 (Claude) analysis.
 */
export function dominantCategory(categoryCounts, opts = {}) {
  const { minSamplesHigh = 3, highShare = 0.8, medShare = 0.6 } = opts;
  const rows = (categoryCounts ?? []).filter((c) => c && c.count > 0);
  const total = rows.reduce((s, c) => s + c.count, 0);
  if (total === 0) return null;

  const sorted = [...rows].sort((a, b) => b.count - a.count);
  const top = sorted[0];
  const share = top.count / total;

  let confidence;
  if (share >= highShare && top.count >= minSamplesHigh) confidence = "high";
  else if (share >= medShare) confidence = "medium";
  else return null; // genuinely split history → Tier 2

  return { categoryId: top.categoryId, categoryPath: top.categoryPath, confidence, share, total, topCount: top.count };
}

/** Human rationale for a Tier-1 proposal. */
export function trainingRationale(result, vendorKey) {
  if (!result) return "";
  const pct = Math.round(result.share * 100);
  return `${result.topCount}/${result.total} prior "${vendorKey}" → ${result.categoryPath} (${pct}%)`;
}
