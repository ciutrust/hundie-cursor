"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/auth/require-user";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { extractVendorSearchKey } from "@/lib/suggestions/category-suggestions";

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

  // Writes go through the service-role client: classifications has no authenticated INSERT policy,
  // so the bulk upsert (insert-or-update) must bypass RLS. The action is already auth-gated above.
  const admin = createServiceRoleClient();
  let query = admin
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
  const { data: catRows, error: catErr } = await admin
    .from("categories")
    .select("id, entity_id");
  if (catErr) return { error: catErr.message };
  const entityByCategory = new Map<string, string>((catRows ?? []).map((c) => [c.id, c.entity_id]));

  // Build the valid commit set (skip no-category and category/entity mismatches).
  type Plan = {
    proposalId: string;
    transactionId: string;
    entityId: string;
    categoryId: string;
    rationale: string | null;
    source: string;
    description: string;
    vendor: string | null;
  };
  const plan: Plan[] = [];
  let skipped = 0;
  for (const p of rows) {
    const entityId = p.chosen_entity_id ?? p.entity_id;
    const categoryId = p.chosen_category_id ?? p.proposed_category_id;
    if (!categoryId || entityByCategory.get(categoryId) !== entityId) {
      skipped += 1; // no category, or a reassigned category that doesn't belong to its entity
      continue;
    }
    plan.push({
      proposalId: p.id,
      transactionId: p.transaction_id,
      entityId,
      categoryId,
      rationale: p.rationale,
      source: p.source,
      description: p.transactions?.description ?? "",
      vendor: p.transactions?.vendor ?? null,
    });
  }
  if (plan.length === 0) return { error: `Nothing valid to commit (${skipped} skipped)` };

  const now = new Date().toISOString();
  const CHUNK = 500;

  // 1) Bulk-upsert classifications (category + entity + provenance note) — a handful of batched
  //    calls instead of one round-trip per transaction, so thousands commit without timing out.
  const txToClass = new Map<string, string>();
  for (let i = 0; i < plan.length; i += CHUNK) {
    const payload = plan.slice(i, i + CHUNK).map((x) => ({
      transaction_id: x.transactionId,
      entity_id: x.entityId,
      category_id: x.categoryId,
      classified_by: createdBy,
      classified_at: now,
      notes: x.rationale ?? null,
    }));
    const { data: up, error: upErr } = await admin
      .from("classifications")
      .upsert(payload, { onConflict: "transaction_id" })
      .select("id, transaction_id");
    if (upErr) return { error: `classification upsert failed: ${upErr.message}` };
    for (const r of up ?? []) txToClass.set(r.transaction_id, r.id);
  }

  // 2) Mark the proposals committed (bulk).
  for (let i = 0; i < plan.length; i += CHUNK) {
    const ids = plan.slice(i, i + CHUNK).map((x) => x.proposalId);
    const { error: stErr } = await admin
      .from("classification_proposals")
      .update({ status: "committed", committed_at: now })
      .in("id", ids);
    if (stErr) return { error: `proposal status update failed: ${stErr.message}` };
  }

  // 3) Best-effort training signal (batched insert; never blocks the commit).
  try {
    const events = plan
      .filter((x) => txToClass.has(x.transactionId))
      .map((x) => ({
        transaction_id: x.transactionId,
        classification_id: txToClass.get(x.transactionId)!,
        entity_id: x.entityId,
        vendor_key: extractVendorSearchKey(x.description, x.vendor),
        suggested_category_id: x.categoryId,
        chosen_category_id: x.categoryId,
        event_type: "accept" as const,
        suggestion_source: x.source,
        created_by: createdBy,
      }));
    for (let i = 0; i < events.length; i += CHUNK) {
      await admin.from("suggestion_events").insert(events.slice(i, i + CHUNK));
    }
  } catch {
    // non-fatal — classifications are already written
  }

  revalidatePath("/review/proposals");
  revalidatePath("/review");
  return { success: true, count: plan.length, skipped };
}
