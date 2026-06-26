"use server";

import { createClient } from "@/lib/supabase/server";
import { extractVendorSearchKey } from "@/lib/suggestions/category-suggestions";

export type SuggestionOutcome = {
  transactionId: string;
  classificationId: string;
  entityId: string;
  description: string;
  vendor: string | null;
  chosenCategoryId: string | null;
  suggestionsShown: Array<{ categoryId: string; source: string }>;
};

export async function logSuggestionEvent(input: SuggestionOutcome, createdBy: string) {
  const supabase = await createClient();
  const vendorKey = extractVendorSearchKey(input.description, input.vendor);
  const suggestionIds = new Set(input.suggestionsShown.map((item) => item.categoryId));

  let eventType: "accept" | "reject" | "manual" = "manual";
  let suggestedCategoryId: string | null = null;
  let suggestionSource: string | null = null;

  if (input.suggestionsShown.length > 0) {
    if (input.chosenCategoryId && suggestionIds.has(input.chosenCategoryId)) {
      eventType = "accept";
      suggestedCategoryId = input.chosenCategoryId;
      suggestionSource =
        input.suggestionsShown.find((item) => item.categoryId === input.chosenCategoryId)?.source ?? null;
    } else {
      eventType = "reject";
      suggestedCategoryId = input.suggestionsShown[0]?.categoryId ?? null;
      suggestionSource = input.suggestionsShown[0]?.source ?? null;
    }
  }

  const { error } = await supabase.from("suggestion_events").insert({
    transaction_id: input.transactionId,
    classification_id: input.classificationId,
    entity_id: input.entityId,
    vendor_key: vendorKey,
    suggested_category_id: suggestedCategoryId,
    chosen_category_id: input.chosenCategoryId,
    event_type: eventType,
    suggestion_source: suggestionSource,
    created_by: createdBy,
  });

  if (error) {
    console.error("logSuggestionEvent failed:", error.message);
  }
}
