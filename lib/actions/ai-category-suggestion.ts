"use server";

import type { CategorySuggestion } from "@/lib/suggestions/category-suggestions";
import {
  getAiSuggestionForTransaction,
  getAiSuggestionsForTransactions,
} from "@/lib/queries/ai-suggestions";

export async function getAiCategorySuggestion(
  transactionId: string,
): Promise<CategorySuggestion | null> {
  const row = await getAiSuggestionForTransaction(transactionId);
  if (!row?.suggested_category_id || !row.suggested_category_path) {
    return null;
  }

  return {
    categoryId: row.suggested_category_id,
    fullPath: row.suggested_category_path,
    count: 1,
    source: "ai_llm",
    confidence: row.confidence as CategorySuggestion["confidence"],
    rationale: row.rationale,
    suggestedEntitySlug: row.entity_slug,
  };
}

const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 } as const;

/**
 * Aggregated stored AI suggestions for a selection (the bulk-assign dialog). Groups the current
 * per-row suggestions by category so 12 rows all pointing at "Hobbies & recreation" become one
 * chip with count 12. Confidence per chip = the best confidence any member row carried. Rows
 * without a current AI suggestion simply contribute nothing.
 */
export async function getAiCategorySuggestionsForSelection(
  transactionIds: string[],
): Promise<CategorySuggestion[]> {
  const ids = transactionIds.filter((id) => typeof id === "string").slice(0, 500);
  if (ids.length === 0) return [];

  const rows = await getAiSuggestionsForTransactions(ids);

  const byCategory = new Map<string, CategorySuggestion>();
  for (const row of rows) {
    if (!row.suggested_category_id || !row.suggested_category_path) continue;
    const confidence = (row.confidence as CategorySuggestion["confidence"]) ?? "low";
    const existing = byCategory.get(row.suggested_category_id);
    if (existing) {
      existing.count += 1;
      if (CONFIDENCE_RANK[confidence] > CONFIDENCE_RANK[existing.confidence]) {
        existing.confidence = confidence;
      }
      continue;
    }
    byCategory.set(row.suggested_category_id, {
      categoryId: row.suggested_category_id,
      fullPath: row.suggested_category_path,
      count: 1,
      source: "ai_llm",
      confidence,
      suggestedEntitySlug: row.entity_slug ?? undefined,
    });
  }

  return [...byCategory.values()].sort((a, b) => b.count - a.count);
}
