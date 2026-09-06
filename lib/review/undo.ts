/**
 * #2 (one-click Undo): the prior classification state we snapshot the instant before a quick-classify
 * or bulk-assign, so a mis-click is reversible with a single button. We capture the prior state
 * CLIENT-SIDE (from the transaction row we already hold) rather than reading the audit table — it's
 * exact, needs no extra query, and restores whatever was there before (including "unclassified").
 *
 * Notes: quick-classify re-writes the SAME notes (so undo need not restore them). Bulk-assign only
 * writes notes when the operator typed one — then `notes` is captured on each restore so undo can
 * put the prior note back. When bulk leaves notes alone, `notes` is omitted from the restore.
 */
export type UndoRestore = {
  classificationId: string;
  entityId: string;
  categoryId: string | null;
  /** Prior notes to restore; omit when the forward action did not touch notes. */
  notes?: string | null;
};

export type UndoGroup = {
  entityId: string;
  categoryId: string | null;
  classificationIds: string[];
  /** Present only when the forward bulk wrote notes (so undo must restore them). */
  notes?: string | null;
};

/**
 * Collapse per-transaction restores into (entityId, categoryId[, notes]) groups so undo can reuse
 * the proven, URL-chunked `bulkReclassifyTransactions` action — one call per distinct prior target.
 * A quick-classify undo is a single group; a bulk undo of a mixed selection restores each row to its
 * own prior category (and prior note when notes were overwritten).
 */
export function groupUndoRestores(restores: UndoRestore[]): UndoGroup[] {
  const map = new Map<string, UndoGroup>();
  for (const r of restores) {
    const notesKey = r.notes === undefined ? "∅" : JSON.stringify(r.notes);
    const key = `${r.entityId}|${r.categoryId ?? ""}|${notesKey}`;
    const existing = map.get(key);
    if (existing) {
      existing.classificationIds.push(r.classificationId);
    } else {
      map.set(key, {
        entityId: r.entityId,
        categoryId: r.categoryId,
        classificationIds: [r.classificationId],
        ...(r.notes !== undefined ? { notes: r.notes } : {}),
      });
    }
  }
  return [...map.values()];
}
