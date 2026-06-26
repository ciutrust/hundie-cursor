"use server";

import { createClient } from "@/lib/supabase/server";
import {
  escapeIlikePattern,
  extractSearchTokens,
  extractSearchTokensFromTransactions,
  rankCategorySuggestions,
  rankConfirmedHistorySuggestions,
  shouldSuggestBulkCategories,
  shouldSuggestCategories,
  type BulkCategorySuggestionInput,
  type CategorySuggestion,
  type CategorySuggestionInput,
} from "@/lib/suggestions/category-suggestions";

async function fetchQbTrainingSuggestions(tokens: string[]) {
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

  return { suggestions: rankCategorySuggestions(data ?? [], "qb_training") };
}

async function fetchConfirmedHistorySuggestions(entitySlug: string, tokens: string[]) {
  const supabase = await createClient();

  const { data: entity, error: entityError } = await supabase
    .from("entities")
    .select("id")
    .eq("slug", entitySlug)
    .single();

  if (entityError || !entity) {
    return { suggestions: [], error: entityError?.message ?? `${entitySlug} entity not found` };
  }

  if (tokens.length === 0) {
    return { suggestions: [] };
  }

  const orFilters = tokens.flatMap((token) => {
    const pattern = escapeIlikePattern(token);
    return [`vendor.ilike.%${pattern}%`, `description.ilike.%${pattern}%`];
  });

  const { data, error } = await supabase
    .from("transactions")
    .select(
      `
      classification:classifications!inner(
        category_id,
        entity_id,
        category:categories(id, full_path)
      )
    `,
    )
    .eq("classification.entity_id", entity.id)
    .not("classification.category_id", "is", null)
    .or(orFilters.join(","));

  if (error) {
    return { suggestions: [], error: error.message };
  }

  const rows =
    data?.map((row) => ({
      category_id: row.classification.category_id,
      category: row.classification.category,
    })) ?? [];

  return { suggestions: rankConfirmedHistorySuggestions(rows) };
}

export async function getCategorySuggestions(
  input: CategorySuggestionInput,
): Promise<{ suggestions: CategorySuggestion[]; error?: string }> {
  if (!shouldSuggestCategories(input)) {
    return { suggestions: [] };
  }

  const tokens = extractSearchTokens(input.description, input.vendor);

  if (input.entitySlug === "gbsl") {
    return fetchQbTrainingSuggestions(tokens);
  }

  if (["personal", "acaa-austin", "pflugerville", "keller"].includes(input.entitySlug)) {
    return fetchConfirmedHistorySuggestions(input.entitySlug, tokens);
  }

  return { suggestions: [] };
}

export async function getBulkCategorySuggestions(
  input: BulkCategorySuggestionInput,
): Promise<{ suggestions: CategorySuggestion[]; error?: string }> {
  if (!shouldSuggestBulkCategories(input)) {
    return { suggestions: [] };
  }

  const tokens = extractSearchTokensFromTransactions(input.transactions);

  if (input.entitySlug === "gbsl") {
    return fetchQbTrainingSuggestions(tokens);
  }

  if (["personal", "acaa-austin", "pflugerville", "keller"].includes(input.entitySlug)) {
    return fetchConfirmedHistorySuggestions(input.entitySlug, tokens);
  }

  return { suggestions: [] };
}
