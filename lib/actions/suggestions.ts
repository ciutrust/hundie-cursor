"use server";

import { createClient } from "@/lib/supabase/server";
import {
  escapeIlikePattern,
  extractSearchTokens,
  rankCategorySuggestions,
  shouldSuggestCategories,
  type CategorySuggestion,
  type CategorySuggestionInput,
} from "@/lib/suggestions/category-suggestions";

export async function getCategorySuggestions(
  input: CategorySuggestionInput,
): Promise<{ suggestions: CategorySuggestion[]; error?: string }> {
  if (!shouldSuggestCategories(input)) {
    return { suggestions: [] };
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { suggestions: [], error: "Not authenticated" };
  }

  const { data: entity, error: entityError } = await supabase
    .from("entities")
    .select("id")
    .eq("slug", "gbsl")
    .single();

  if (entityError || !entity) {
    return { suggestions: [], error: entityError?.message ?? "GBSL entity not found" };
  }

  const tokens = extractSearchTokens(input.description, input.vendor);
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
