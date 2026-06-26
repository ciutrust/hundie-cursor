"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { logSuggestionEvent, type SuggestionOutcome } from "@/lib/actions/suggestion-events";
import { createClient } from "@/lib/supabase/server";

export type ReclassifyInput = {
  classificationId: string;
  entityId: string;
  categoryId: string | null;
  notes: string | null;
  month: string;
  entitySlug: string;
  suggestionOutcome?: SuggestionOutcome | null;
};

export type BulkReclassifyInput = {
  classificationIds: string[];
  entityId: string;
  categoryId: string | null;
  entitySlug: string;
  suggestionOutcome?: SuggestionOutcome | null;
};

export async function reclassifyTransaction(input: ReclassifyInput) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  const notes = input.notes?.trim() || null;

  const { error } = await supabase
    .from("classifications")
    .update({
      entity_id: input.entityId,
      category_id: input.categoryId,
      notes,
      classified_by: user.email ?? user.id,
      classified_at: new Date().toISOString(),
    })
    .eq("id", input.classificationId);

  if (error) {
    return { error: error.message };
  }

  if (input.suggestionOutcome) {
    await logSuggestionEvent(input.suggestionOutcome, user.email ?? user.id);
  }

  revalidatePath("/review");
  revalidatePath(`/review/${input.entitySlug}`);
  revalidatePath("/review/unclassified");

  return { success: true };
}

export async function bulkReclassifyTransactions(input: BulkReclassifyInput) {
  if (input.classificationIds.length === 0) {
    return { error: "No transactions selected" };
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  const { error } = await supabase
    .from("classifications")
    .update({
      entity_id: input.entityId,
      category_id: input.categoryId,
      classified_by: user.email ?? user.id,
      classified_at: new Date().toISOString(),
    })
    .in("id", input.classificationIds);

  if (error) {
    return { error: error.message };
  }

  if (input.suggestionOutcome) {
    await logSuggestionEvent(input.suggestionOutcome, user.email ?? user.id);
  }

  revalidatePath("/review");
  revalidatePath(`/review/${input.entitySlug}`);
  revalidatePath("/review/unclassified");

  return { success: true, count: input.classificationIds.length };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
