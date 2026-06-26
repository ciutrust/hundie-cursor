/**
 * C10 — intercompany double-count aid (v1: manual).
 *
 * GBSL pays a lease to Austin ACAA House LLC (which owns the 136 Anita rental).
 * The lease is a real GBSL expense; the only way it gets double-counted is if a
 * mirror/redirect of the same charge is also booked under another entity. There
 * is no automatic elimination — this just SURFACES the legs and flags any pair
 * that shares |amount| + date across DIFFERENT entities so a human can verify it
 * isn't counted twice. Pure so it can be unit-tested.
 */
export type IntercompanyLeg = {
  entitySlug: string;
  transactionDate: string;
  amount: number;
  categoryPath: string;
  description: string;
};

export type FlaggedLeg = IntercompanyLeg & { potentialMirror: boolean };

function key(date: string, amount: number) {
  return `${date}|${(Math.round(Math.abs(amount) * 100) / 100).toFixed(2)}`;
}

export function flagIntercompanyMatches<T extends IntercompanyLeg>(
  rows: T[],
): Array<T & { potentialMirror: boolean }> {
  const entitiesByKey = new Map<string, Set<string>>();
  for (const row of rows) {
    const k = key(row.transactionDate, row.amount);
    const set = entitiesByKey.get(k) ?? new Set<string>();
    set.add(row.entitySlug);
    entitiesByKey.set(k, set);
  }

  return rows.map((row) => ({
    ...row,
    // a mirror exists only if the same date+|amount| appears under a DIFFERENT entity
    potentialMirror: (entitiesByKey.get(key(row.transactionDate, row.amount))?.size ?? 0) > 1,
  }));
}
