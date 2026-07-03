// Pure helper for the proposals review panel. A vendor group's one-click "approve" applies a single
// category to every row in the group. That is only safe when every row shares the SAME proposed
// category. A heterogeneous group (e.g. a Tier-1 rerun over a partially Tier-2'd vendor) would silently
// commit every row with proposals[0]'s category — a misclassification with no visual cue (C13).

/** True when all rows share the same `proposed_category_id` (null counts as a distinct value). */
export function groupIsHomogeneous(proposals: Array<{ proposed_category_id: string | null }>): boolean {
  if (proposals.length <= 1) return true;
  const first = proposals[0].proposed_category_id;
  return proposals.every((p) => p.proposed_category_id === first);
}
