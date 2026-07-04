// #4 — the in-app deterministic proposal generator's PURE core (the CLI's Tier-1 logic, extracted for
// reuse + testing). For each entity: learn vendor→category from that entity's qb_training_expenses,
// then propose a category for every unclassified transaction whose vendor matches with enough
// agreement. Writes go to the classification_proposals STAGING table (nothing touches the ledger until
// the operator clicks Commit). The DB reads live in lib/actions/generate-proposals.ts; this stays pure.

import { extractVendorSearchKey } from "@/lib/suggestions/category-suggestions";
import { dominantCategory, trainingRationale } from "@/lib/suggestions/proposal-ranking";

export type TrainingRow = {
  category_id: string | null;
  vendor_name: string | null;
  description: string | null;
};

export type UnclassifiedRow = {
  transaction_id: string;
  description: string | null;
  vendor: string | null;
};

/** A staged classification_proposals row (source='training'). */
export type ProposalRow = {
  transaction_id: string;
  entity_id: string;
  entity_slug: string;
  vendor_key: string;
  proposed_category_id: string;
  proposed_category_path: string;
  confidence: string;
  source: string;
  rationale: string;
  status: string;
};

export type BuildTrainingProposalsInput = {
  entityId: string;
  entitySlug: string;
  /** id -> full_path, ACTIVE categories only (inactive filtered upstream so we never propose a hidden one). */
  activePathById: Map<string, string>;
  training: TrainingRow[];
  unclassified: UnclassifiedRow[];
};

export function buildTrainingProposals(input: BuildTrainingProposalsInput): ProposalRow[] {
  const { entityId, entitySlug, activePathById, training, unclassified } = input;

  // 1) training tally: vendorKey -> (categoryId -> count), active categories only.
  const tally = new Map<string, Map<string, number>>();
  for (const t of training) {
    if (!t.category_id || !activePathById.has(t.category_id)) continue;
    const vk = extractVendorSearchKey(t.description ?? "", t.vendor_name);
    if (!vk) continue;
    const m = tally.get(vk) ?? new Map<string, number>();
    m.set(t.category_id, (m.get(t.category_id) ?? 0) + 1);
    tally.set(vk, m);
  }

  // 2) propose for each unclassified transaction whose vendor matches with enough agreement.
  const proposals: ProposalRow[] = [];
  for (const row of unclassified) {
    const vk = extractVendorSearchKey(row.description ?? "", row.vendor);
    if (!vk) continue;
    const counts = [...(tally.get(vk)?.entries() ?? [])].map(([categoryId, count]) => ({
      categoryId,
      categoryPath: activePathById.get(categoryId) ?? "",
      count,
    }));
    const result = dominantCategory(counts);
    if (!result) continue;
    proposals.push({
      transaction_id: row.transaction_id,
      entity_id: entityId,
      entity_slug: entitySlug,
      vendor_key: vk,
      proposed_category_id: result.categoryId,
      proposed_category_path: result.categoryPath,
      confidence: result.confidence,
      source: "training",
      rationale: trainingRationale(result, vk),
      status: "pending",
    });
  }
  return proposals;
}

/**
 * 🔴 CRITICAL correctness guard: an upsert on transaction_id resets status to 'pending', which would
 * REVERT an already-committed proposal. Drop any proposal whose transaction already has a committed
 * proposal so re-running the generator never un-commits work. (Pure so it's unit-tested directly.)
 */
export function excludeCommitted(proposals: ProposalRow[], committedTxIds: Set<string>): ProposalRow[] {
  if (committedTxIds.size === 0) return proposals;
  return proposals.filter((p) => !committedTxIds.has(p.transaction_id));
}
