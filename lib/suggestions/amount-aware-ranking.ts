export const MIN_AMOUNT_BUCKET_COUNT = 2;
export const AMOUNT_MATCH_TOLERANCE = 0.01;

export type AmountHistoryRow = {
  amount: number;
  category_id: string | null;
  category: { id: string; full_path: string } | null;
};

export type AmountBucketMatch = {
  categoryId: string;
  fullPath: string;
  count: number;
  matchType: "exact" | "nearest";
  bucketAmount: number;
};

/** Signed rounding so refund buckets stay separate from charge buckets (BUG-10). */
function signedRoundAmount(amount: number): number {
  return Math.round(amount * 100) / 100;
}

type AmountCluster = {
  amount: number;
  totalCount: number;
  categories: Map<string, { categoryId: string; fullPath: string; count: number }>;
};

function buildAmountClusters(rows: AmountHistoryRow[]): AmountCluster[] {
  const byAmount = new Map<number, AmountCluster>();

  for (const row of rows) {
    const categoryId = row.category_id ?? row.category?.id;
    const fullPath = row.category?.full_path;
    if (!categoryId || !fullPath) continue;

    const amount = signedRoundAmount(row.amount);
    let cluster = byAmount.get(amount);
    if (!cluster) {
      cluster = { amount, totalCount: 0, categories: new Map() };
      byAmount.set(amount, cluster);
    }

    cluster.totalCount += 1;
    const existing = cluster.categories.get(categoryId);
    if (existing) {
      existing.count += 1;
    } else {
      cluster.categories.set(categoryId, { categoryId, fullPath, count: 1 });
    }
  }

  return [...byAmount.values()];
}

function clusterToMatches(
  cluster: AmountCluster,
  matchType: AmountBucketMatch["matchType"],
): AmountBucketMatch[] {
  return [...cluster.categories.values()]
    .sort((a, b) => b.count - a.count)
    .map((entry) => ({
      categoryId: entry.categoryId,
      fullPath: entry.fullPath,
      count: entry.count,
      matchType,
      bucketAmount: cluster.amount,
    }));
}

/** Rank categories for a target amount from confirmed vendor history. */
export function rankAmountAwareMatches(
  targetAmount: number,
  rows: AmountHistoryRow[],
  minBucketCount = MIN_AMOUNT_BUCKET_COUNT,
): AmountBucketMatch[] {
  const clusters = buildAmountClusters(rows);
  if (clusters.length === 0) return [];

  const target = signedRoundAmount(targetAmount);

  const exact = clusters.find((cluster) => Math.abs(cluster.amount - target) < AMOUNT_MATCH_TOLERANCE);
  if (exact && exact.totalCount >= minBucketCount) {
    return clusterToMatches(exact, "exact");
  }

  const eligible = clusters
    .filter((cluster) => cluster.totalCount >= minBucketCount)
    .sort((a, b) => Math.abs(a.amount - target) - Math.abs(b.amount - target));

  if (eligible.length === 0) return [];

  return clusterToMatches(eligible[0], "nearest");
}

/** Pick one amount for bulk assign when txs share the same (or majority) amount. */
export function representativeBulkAmount(amounts: number[]): number | undefined {
  if (amounts.length === 0) return undefined;

  const rounded = amounts.map(signedRoundAmount);
  const counts = new Map<number, number>();
  for (const amount of rounded) {
    counts.set(amount, (counts.get(amount) ?? 0) + 1);
  }

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const [topAmount, topCount] = sorted[0] ?? [];

  if (topAmount === undefined || topCount === undefined) return undefined;
  if (topCount > amounts.length / 2) return topAmount;

  return undefined;
}
