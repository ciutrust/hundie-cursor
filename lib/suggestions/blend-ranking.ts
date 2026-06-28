import type { AmountBucketMatch } from "@/lib/suggestions/amount-aware-ranking";
import type { CategorySuggestion } from "@/lib/suggestions/category-suggestions";

export type SuggestionSourceKind = CategorySuggestion["source"];

export type WeightedCategoryEntry = {
  categoryId: string;
  fullPath: string;
  score: number;
  qbScore: number;
  ledgerScore: number;
  eventScore: number;
  amountScore: number;
  matchCount: number;
  amountMatchType?: AmountBucketMatch["matchType"];
};

/** Months ago → weight. Current month = 3, last month = 2, older = 1. */
export function recencyWeight(isoDate: string, reference = new Date()): number {
  const [year, month] = isoDate.slice(0, 10).split("-").map(Number);
  const monthsAgo =
    (reference.getFullYear() - year) * 12 + (reference.getMonth() + 1 - month);
  if (monthsAgo <= 0) return 3;
  if (monthsAgo === 1) return 2;
  return 1;
}

// Per-occurrence score weights. Amount signals dominate because a matching prior amount
// for the same vendor is the strongest evidence we have. For context, the other sources
// are weighted (× recency, recency ∈ {1,2,3}): qb training = 1, ledger history = 1.5,
// suggestion-event accept/override = 2.5 (see mergeWeightedSuggestions below).
const AMOUNT_EXACT_WEIGHT = 6; // exact prior-amount match for this vendor (strongest amount signal)
const AMOUNT_NEAREST_WEIGHT = 4; // closest prior amount when there is no exact hit

/**
 * OPT-09: which source label a ranked entry gets. Extracted verbatim from the former
 * nested ternary (same branch order) — amount dominance first, then ledger, then events,
 * then the qb/blended fallbacks. Pure; the caller applies the confirmed_history→blended
 * remap afterwards.
 */
export function resolvePrimarySource(
  e: Pick<WeightedCategoryEntry, "qbScore" | "ledgerScore" | "eventScore" | "amountScore">,
): SuggestionSourceKind {
  if (
    e.amountScore > 0 &&
    e.amountScore >= e.qbScore &&
    e.amountScore >= e.ledgerScore &&
    e.amountScore >= e.eventScore
  ) {
    return "amount_match";
  }
  if (e.ledgerScore >= e.qbScore && e.ledgerScore >= e.eventScore) return "confirmed_history";
  if (e.eventScore > e.qbScore) return "confirmed_history";
  if (e.qbScore > 0 && e.ledgerScore > 0) return "blended";
  if (e.qbScore > 0) return "qb_training";
  return "confirmed_history";
}

/**
 * OPT-09: confidence bucket for a ranked entry. Extracted verbatim from the former
 * if/else-if chain (same branch order). Only the top entry (index 0) can be "high".
 */
export function resolveConfidence(
  e: Pick<WeightedCategoryEntry, "score" | "amountScore" | "amountMatchType">,
  index: number,
  share: number,
): CategorySuggestion["confidence"] {
  if (
    index === 0 &&
    e.amountScore > 0 &&
    e.amountMatchType === "exact" &&
    e.amountScore >= AMOUNT_EXACT_WEIGHT * 2
  ) {
    return "high";
  }
  if (index === 0 && e.score >= 4 && share >= 0.45) return "high";
  if (e.score >= 2 && share >= 0.25) return "medium";
  return "low";
}

export function mergeWeightedSuggestions(
  qbRows: Array<{ category_id: string | null; category_name: string }>,
  ledgerRows: Array<{
    category_id: string | null;
    category: { id: string; full_path: string } | null;
    transaction_date: string;
  }>,
  eventRows: Array<{
    suggested_category_id: string | null;
    chosen_category_id: string | null;
    event_type: string;
    created_at: string;
    category?: { id: string; full_path: string } | null;
    chosen?: { id: string; full_path: string } | null;
  }>,
  amountAwareMatches: AmountBucketMatch[] = [],
): CategorySuggestion[] {
  const entries = new Map<string, WeightedCategoryEntry>();

  function ensure(categoryId: string, fullPath: string) {
    const existing = entries.get(categoryId);
    if (existing) return existing;
    const created: WeightedCategoryEntry = {
      categoryId,
      fullPath,
      score: 0,
      qbScore: 0,
      ledgerScore: 0,
      eventScore: 0,
      amountScore: 0,
      matchCount: 0,
    };
    entries.set(categoryId, created);
    return created;
  }

  for (const row of qbRows) {
    if (!row.category_id) continue;
    const entry = ensure(row.category_id, row.category_name);
    entry.qbScore += 1;
    entry.score += 1;
    entry.matchCount += 1;
  }

  for (const row of ledgerRows) {
    const categoryId = row.category_id ?? row.category?.id;
    const fullPath = row.category?.full_path;
    if (!categoryId || !fullPath) continue;
    const weight = 1.5 * recencyWeight(row.transaction_date);
    const entry = ensure(categoryId, fullPath);
    entry.ledgerScore += weight;
    entry.score += weight;
    entry.matchCount += 1;
  }

  for (const row of eventRows) {
    const createdAt = row.created_at.slice(0, 10);
    const weight = recencyWeight(createdAt);

    if (row.event_type === "accept" && row.chosen_category_id) {
      const fullPath = row.chosen?.full_path ?? row.category?.full_path ?? "Unknown";
      const entry = ensure(row.chosen_category_id, fullPath);
      entry.eventScore += 2.5 * weight;
      entry.score += 2.5 * weight;
      entry.matchCount += 1;
    }

    if (row.event_type === "reject") {
      // Override: the operator chose chosen_category_id instead of the suggestion.
      // Credit their choice so an override reinforces the engine via events too —
      // not only via confirmed history. This is what makes an override "count".
      if (row.chosen_category_id) {
        const fullPath = row.chosen?.full_path ?? row.category?.full_path ?? "Unknown";
        const entry = ensure(row.chosen_category_id, fullPath);
        entry.eventScore += 2.5 * weight;
        entry.score += 2.5 * weight;
        entry.matchCount += 1;
      }
      // Small negative signal for the suggestion the operator did not keep.
      if (row.suggested_category_id) {
        const entry = entries.get(row.suggested_category_id);
        if (entry) {
          entry.eventScore -= 0.5 * weight;
          entry.score -= 0.5 * weight;
        }
      }
    }
  }

  for (const match of amountAwareMatches) {
    const weight = match.matchType === "exact" ? AMOUNT_EXACT_WEIGHT : AMOUNT_NEAREST_WEIGHT;
    const entry = ensure(match.categoryId, match.fullPath);
    entry.amountScore += weight * match.count;
    entry.score += weight * match.count;
    entry.matchCount += match.count;
    if (!entry.amountMatchType || match.matchType === "exact") {
      entry.amountMatchType = match.matchType;
    }
  }

  const ranked = [...entries.values()]
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const totalScore = ranked.reduce((sum, entry) => sum + entry.score, 0);

  return ranked.map((entry, index) => {
    const primarySource = resolvePrimarySource(entry);

    const displayCount = Math.max(1, entry.matchCount);
    const share = entry.score / Math.max(totalScore, 1);

    const confidence = resolveConfidence(entry, index, share);

    const source =
      primarySource === "confirmed_history" && entry.qbScore > 0 && entry.amountScore === 0
        ? "blended"
        : primarySource;

    return {
      categoryId: entry.categoryId,
      fullPath: entry.fullPath,
      count: displayCount,
      source,
      confidence,
      amountMatchType: entry.amountMatchType,
    };
  });
}
