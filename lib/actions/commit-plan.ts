// Pure commit-planning helper, kept OUT of proposals.ts (a "use server" module, where every export
// must be an async Server Action). This lets it be a synchronous, directly unit-testable function.

// Provenance values meaning "machine placeholder, safe to overwrite". Anything else (a user email,
// qb_backfill, refund_backfill, etc.) is a real classification we must not clobber.
const OVERWRITABLE_CLASSIFIERS = new Set(["import", "import-heal"]);

export type ExistingClass = { category_id: string | null; classified_by: string | null; notes: string | null };

export type CommitCandidate = {
  proposalId: string; transactionId: string; entityId: string; categoryId: string;
  rationale: string | null; source: string; description: string; vendor: string | null;
  // Provenance for the training signal: the category the engine PROPOSED, and whether the operator
  // overrode it. Threaded through so the commit logs accept vs. reject correctly (C16).
  proposedCategoryId: string | null; wasOverride: boolean;
};

/** Guard against clobbering interim manual work: skip any candidate whose transaction already has a
 *  non-null category or a non-machine classifier, and never overwrite an existing note with null. */
export function partitionCommitPlan(
  candidates: CommitCandidate[],
  existingByTx: Map<string, ExistingClass>,
): { toWrite: (CommitCandidate & { keepNote: string | null })[]; staleProposalIds: string[] } {
  const toWrite: (CommitCandidate & { keepNote: string | null })[] = [];
  const staleProposalIds: string[] = [];
  for (const c of candidates) {
    const existing = existingByTx.get(c.transactionId);
    const protectedRow =
      !!existing &&
      (existing.category_id != null ||
        !OVERWRITABLE_CLASSIFIERS.has(existing.classified_by ?? "import"));
    if (protectedRow) { staleProposalIds.push(c.proposalId); continue; }
    const keepNote = existing?.notes ?? c.rationale ?? null;
    toWrite.push({ ...c, keepNote });
  }
  return { toWrite, staleProposalIds };
}
