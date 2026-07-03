/**
 * C10 — intercompany double-count aid (v1: manual).
 *
 * GBSL pays a lease to Austin ACAA House LLC (which owns the 136 Anita rental).
 * The lease is a real GBSL expense; the only way it gets double-counted is if a
 * mirror/redirect of the same charge is also booked under another entity. There
 * is no automatic elimination — this just SURFACES the legs and flags any pair
 * that shares |amount| across DIFFERENT entities WITHIN a ±3-day window so a human
 * can verify it isn't counted twice. Pure so it can be unit-tested.
 *
 * C19: mirror legs post 1–3 days apart (the 136 Anita legs), so exact-date keying missed them.
 * We now bucket by rounded |amount| and, within a bucket, flag a leg when some OTHER leg has a
 * DIFFERENT entitySlug and a transactionDate within ±3 days. Widening is safe: this only FLAGS
 * for human review (amber row), never auto-eliminates — worst case is a few extra rows to check.
 */
export type IntercompanyLeg = {
  entitySlug: string;
  transactionDate: string;
  amount: number;
  categoryPath: string;
  description: string;
};

export type FlaggedLeg = IntercompanyLeg & { potentialMirror: boolean };

const MIRROR_WINDOW_DAYS = 3;

/** Rounded absolute amount, used to bucket legs. */
function amountKey(amount: number) {
  return (Math.round(Math.abs(amount) * 100) / 100).toFixed(2);
}

/**
 * Whole-day difference between two `YYYY-MM-DD` dates. Parses each as `T00:00:00.000Z` and diffs in
 * UTC ms / 86_400_000 so a DST/TZ shift can't introduce an off-by-one (mirrors lib/plaid/cutover.ts).
 */
function dayDiff(a: string, b: string): number {
  const ms = Date.parse(`${a}T00:00:00.000Z`) - Date.parse(`${b}T00:00:00.000Z`);
  return Math.round(ms / 86_400_000);
}

export function flagIntercompanyMatches<T extends IntercompanyLeg>(
  rows: T[],
): Array<T & { potentialMirror: boolean }> {
  // Bucket every leg's index by rounded |amount| so we only compare same-amount legs.
  const indicesByAmount = new Map<string, number[]>();
  rows.forEach((row, i) => {
    const k = amountKey(row.amount);
    const arr = indicesByAmount.get(k) ?? [];
    arr.push(i);
    indicesByAmount.set(k, arr);
  });

  return rows.map((row, i) => {
    const bucket = indicesByAmount.get(amountKey(row.amount)) ?? [];
    // A mirror exists iff some OTHER leg in this amount bucket has a DIFFERENT entity and posts
    // within ±3 days.
    const potentialMirror = bucket.some((j) => {
      if (j === i) return false;
      const other = rows[j];
      return (
        other.entitySlug !== row.entitySlug &&
        Math.abs(dayDiff(row.transactionDate, other.transactionDate)) <= MIRROR_WINDOW_DAYS
      );
    });
    return { ...row, potentialMirror };
  });
}
