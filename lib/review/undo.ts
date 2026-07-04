/**
 * #2 (one-click Undo): the prior classification state we snapshot the instant before a quick-classify
 * or bulk-assign, so a mis-click is reversible with a single button. We capture the prior state
 * CLIENT-SIDE (from the transaction row we already hold) rather than reading the audit table — it's
 * exact, needs no extra query, and restores whatever was there before (including "unclassified").
 *
 * Notes are intentionally not restored: quick-classify re-writes the SAME notes and bulk-assign never
 * touches notes, so the prior notes are already intact on undo.
 */
export type UndoRestore = {
  classificationId: string;
  entityId: string;
  categoryId: string | null;
};

export type UndoGroup = {
  entityId: string;
  categoryId: string | null;
  classificationIds: string[];
};

/**
 * Collapse per-transaction restores into (entityId, categoryId) groups so undo can reuse the proven,
 * URL-chunked `bulkReclassifyTransactions` action — one call per distinct prior target. A quick-classify
 * undo is a single group; a bulk undo of a mixed selection restores each row to its own prior category.
 */
export function groupUndoRestores(restores: UndoRestore[]): UndoGroup[] {
  const map = new Map<string, UndoGroup>();
  for (const r of restores) {
    const key = `${r.entityId}|${r.categoryId ?? ""}`;
    const existing = map.get(key);
    if (existing) {
      existing.classificationIds.push(r.classificationId);
    } else {
      map.set(key, {
        entityId: r.entityId,
        categoryId: r.categoryId,
        classificationIds: [r.classificationId],
      });
    }
  }
  return [...map.values()];
}
