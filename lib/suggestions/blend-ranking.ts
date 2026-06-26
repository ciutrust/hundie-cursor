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

const AMOUNT_EXACT_WEIGHT = 6;
const AMOUNT_NEAREST_WEIGHT = 4;

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

    if (row.event_type === "reject" && row.suggested_category_id) {
      const entry = entries.get(row.suggested_category_id);
      if (entry) {
        entry.eventScore -= 0.5 * weight;
        entry.score -= 0.5 * weight;
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
    const primarySource: SuggestionSourceKind =
      entry.amountScore > 0 &&
      entry.amountScore >= entry.qbScore &&
      entry.amountScore >= entry.ledgerScore &&
      entry.amountScore >= entry.eventScore
        ? "amount_match"
        : entry.ledgerScore >= entry.qbScore && entry.ledgerScore >= entry.eventScore
          ? "confirmed_history"
          : entry.eventScore > entry.qbScore
            ? "confirmed_history"
            : entry.qbScore > 0 && entry.ledgerScore > 0
              ? "blended"
              : entry.qbScore > 0
                ? "qb_training"
                : "confirmed_history";

    const displayCount = Math.max(1, entry.matchCount);
    const share = entry.score / Math.max(totalScore, 1);

    let confidence: CategorySuggestion["confidence"] = "low";
    if (
      index === 0 &&
      entry.amountScore > 0 &&
      entry.amountMatchType === "exact" &&
      entry.amountScore >= AMOUNT_EXACT_WEIGHT * 2
    ) {
      confidence = "high";
    } else if (index === 0 && entry.score >= 4 && share >= 0.45) {
      confidence = "high";
    } else if (entry.score >= 2 && share >= 0.25) {
      confidence = "medium";
    }

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
