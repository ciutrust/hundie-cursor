"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { logSuggestionEvent, type SuggestionOutcome } from "@/lib/actions/suggestion-events";
import { chunk } from "@/lib/supabase/chunk";
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

  if (input.categoryId) {
    const { data: category, error: categoryError } = await supabase
      .from("categories")
      .select("entity_id")
      .eq("id", input.categoryId)
      .maybeSingle();

    if (categoryError) return { error: categoryError.message };
    if (!category || category.entity_id !== input.entityId) {
      return { error: "Category does not belong to the selected entity" };
    }
  }

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
  // The /transactions browser and the expense-report detail render these same rows, so an edit made
  // from either surface has to refresh them too. The detail route needs its own dynamic-path
  // invalidation — revalidatePath("/expense-reports") does NOT match "/expense-reports/0001".
  revalidatePath("/transactions");
  revalidatePath("/expense-reports");
  revalidatePath("/expense-reports/[number]", "page");

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

  if (input.categoryId) {
    const { data: category, error: categoryError } = await supabase
      .from("categories")
      .select("entity_id")
      .eq("id", input.categoryId)
      .maybeSingle();

    if (categoryError) return { error: categoryError.message };
    if (!category || category.entity_id !== input.entityId) {
      return { error: "Category does not belong to the selected entity" };
    }
  }

  // A2: chunk the id list — select-all / find-similar can exceed ~420 ids, and `.in()` on a PATCH
  // rides the URL, so an unchunked bulk reclassify would 400 and save nothing.
  const classifiedAt = new Date().toISOString();
  for (const ids of chunk(input.classificationIds, 200)) {
    const { error } = await supabase
      .from("classifications")
      .update({
        entity_id: input.entityId,
        category_id: input.categoryId,
        classified_by: user.email ?? user.id,
        classified_at: classifiedAt,
      })
      .in("id", ids);

    if (error) {
      return { error: error.message };
    }
  }

  if (input.suggestionOutcome) {
    await logSuggestionEvent(input.suggestionOutcome, user.email ?? user.id);
  }

  revalidatePath("/review");
  revalidatePath(`/review/${input.entitySlug}`);
  revalidatePath("/review/unclassified");
  // The /transactions browser and the expense-report detail render these same rows, so an edit made
  // from either surface has to refresh them too. The detail route needs its own dynamic-path
  // invalidation — revalidatePath("/expense-reports") does NOT match "/expense-reports/0001".
  revalidatePath("/transactions");
  revalidatePath("/expense-reports");
  revalidatePath("/expense-reports/[number]", "page");

  return { success: true, count: input.classificationIds.length };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
