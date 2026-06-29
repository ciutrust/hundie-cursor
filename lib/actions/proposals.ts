"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/auth/require-user";
import { logSuggestionEvent } from "@/lib/actions/suggestion-events";

// classification_proposals isn't in the generated DB types (no CLI to regen); access via an
// untyped client view. classifications/entities stay on the typed client.

type Decision = "approved" | "rejected" | "pending";

/** Stage a decision (and optional category override) on a set of proposals. Writes ONLY the
 *  staging table — never `classifications`. */
export async function setProposalDecision(
  proposalIds: string[],
  decision: Decision,
  chosenCategoryId?: string | null,
  chosenEntityId?: string | null,
): Promise<{ success: true; count: number } | { error: string }> {
  const { error: authError, supabase } = await requireUser();
  if (authError) return { error: authError };
  if (proposalIds.length === 0) return { error: "Nothing selected" };

  const db = supabase as unknown as SupabaseClient;
  const patch: Record<string, unknown> = { status: decision, updated_at: new Date().toISOString() };
  if (chosenCategoryId !== undefined) patch.chosen_category_id = chosenCategoryId;
  if (chosenEntityId !== undefined) patch.chosen_entity_id = chosenEntityId;

  const { error } = await db.from("classification_proposals").update(patch).in("id", proposalIds);
  if (error) return { error: error.message };

  revalidatePath("/review/proposals");
  return { success: true, count: proposalIds.length };
}

type ApprovedRow = {
  id: string;
  transaction_id: string;
  entity_id: string;
  chosen_entity_id: string | null;
  source: string;
  proposed_category_id: string | null;
  chosen_category_id: string | null;
  rationale: string | null;
  transactions: { description: string; vendor: string | null } | null;
};

/** The ONLY thing that writes real classifications. For every approved proposal (optionally one
 *  entity), set the transaction's category (override or proposed), mark the proposal committed,
 *  and log a suggestion event so the engine learns. Idempotent: committed rows are skipped. */
export async function commitApprovedProposals(
  entitySlug?: string,
): Promise<{ success: true; count: number; skipped: number } | { error: string }> {
  const { error: authError, supabase } = await requireUser();
  if (authError) return { error: authError };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const createdBy = user?.email ?? user?.id ?? "proposal-review";

  const db = supabase as unknown as SupabaseClient;
  let query = db
    .from("classification_proposals")
    .select(
      "id, transaction_id, entity_id, chosen_entity_id, source, proposed_category_id, chosen_category_id, rationale, transactions!inner(description, vendor)",
    )
    .eq("status", "approved");
  if (entitySlug) query = query.eq("entity_slug", entitySlug);

  const { data, error } = await query;
  if (error) return { error: error.message };
  const rows = (data ?? []) as unknown as ApprovedRow[];
  if (rows.length === 0) return { error: "No approved proposals to commit" };

  // category -> entity map, to guard that a (possibly reassigned) category belongs to its entity.
  const { data: catRows, error: catErr } = await supabase
    .from("categories")
    .select("id, entity_id");
  if (catErr) return { error: catErr.message };
  const entityByCategory = new Map<string, string>((catRows ?? []).map((c) => [c.id, c.entity_id]));

  let committed = 0;
  let skipped = 0;
  for (const p of rows) {
    const entityId = p.chosen_entity_id ?? p.entity_id;
    const categoryId = p.chosen_category_id ?? p.proposed_category_id;
    if (!categoryId) {
      skipped += 1; // never commit an "unclassified" — leave it pending-ish
      continue;
    }
    // Reassigned entity must own the chosen category (the UI enforces this; guard anyway).
    if (entityByCategory.get(categoryId) !== entityId) {
      skipped += 1;
      continue;
    }

    const { data: cls, error: upErr } = await supabase
      .from("classifications")
      .update({
        entity_id: entityId,
        category_id: categoryId,
        classified_by: createdBy,
        classified_at: new Date().toISOString(),
        // preserve the "why" on the transaction itself (provenance for CPA/audit + your manual notes).
        ...(p.rationale ? { notes: p.rationale } : {}),
      })
      .eq("transaction_id", p.transaction_id)
      .select("id")
      .single();
    if (upErr) return { error: `classification update failed: ${upErr.message}` };

    await db
      .from("classification_proposals")
      .update({ status: "committed", committed_at: new Date().toISOString() })
      .eq("id", p.id);

    // Best-effort training signal (mirrors acceptAiSuggestions): records the proposal as the
    // shown suggestion so keeping it = accept, overriding it = reject.
    try {
      await logSuggestionEvent(
        {
          transactionId: p.transaction_id,
          classificationId: cls.id,
          entityId,
          description: p.transactions?.description ?? "",
          vendor: p.transactions?.vendor ?? null,
          chosenCategoryId: categoryId,
          suggestionsShown: p.proposed_category_id
            ? [{ categoryId: p.proposed_category_id, source: p.source }]
            : [],
        },
        createdBy,
      );
    } catch {
      // non-fatal: the classification is already written
    }
    committed += 1;
  }

  revalidatePath("/review/proposals");
  revalidatePath("/review");
  return { success: true, count: committed, skipped };
}
