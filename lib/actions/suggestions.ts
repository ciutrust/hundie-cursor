"use server";

import { createClient } from "@/lib/supabase/server";
import {
  escapeIlikePattern,
  extractSearchTokens,
  extractSearchTokensFromTransactions,
  rankCategorySuggestions,
  shouldSuggestBulkCategories,
  shouldSuggestCategories,
  type BulkCategorySuggestionInput,
  type CategorySuggestion,
  type CategorySuggestionInput,
} from "@/lib/suggestions/category-suggestions";

async function fetchSuggestionsForTokens(tokens: string[]) {
  const supabase = await createClient();

  const { data: entity, error: entityError } = await supabase
    .from("entities")
    .select("id")
    .eq("slug", "gbsl")
    .single();

  if (entityError || !entity) {
    return { suggestions: [], error: entityError?.message ?? "GBSL entity not found" };
  }

  if (tokens.length === 0) {
    return { suggestions: [] };
  }

  const orFilters = tokens.flatMap((token) => {
    const pattern = escapeIlikePattern(token);
    return [`vendor_name.ilike.%${pattern}%`, `description.ilike.%${pattern}%`];
  });

  const { data, error } = await supabase
    .from("qb_training_expenses")
    .select("category_id, category_name")
    .eq("entity_id", entity.id)
    .or(orFilters.join(","));

  if (error) {
    return { suggestions: [], error: error.message };
  }

  return { suggestions: rankCategorySuggestions(data ?? []) };
}

export async function getCategorySuggestions(
  input: CategorySuggestionInput,
): Promise<{ suggestions: CategorySuggestion[]; error?: string }> {
  if (!shouldSuggestCategories(input)) {
    return { suggestions: [] };
  }

  const tokens = extractSearchTokens(input.description, input.vendor);
  return fetchSuggestionsForTokens(tokens);
}

export async function getBulkCategorySuggestions(
  input: BulkCategorySuggestionInput,
): Promise<{ suggestions: CategorySuggestion[]; error?: string }> {
  if (!shouldSuggestBulkCategories(input)) {
    return { suggestions: [] };
  }

  const tokens = extractSearchTokensFromTransactions(input.transactions);
  return fetchSuggestionsForTokens(tokens);
}
