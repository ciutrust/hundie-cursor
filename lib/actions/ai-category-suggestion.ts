"use server";

import type { CategorySuggestion } from "@/lib/suggestions/category-suggestions";
import { getAiSuggestionForTransaction } from "@/lib/queries/ai-suggestions";

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
