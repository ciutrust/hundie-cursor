"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { centsToNumber } from "@/lib/money";
import { isUuid } from "@/lib/uuid";
import { validateSplit, type SplitLegDraft } from "@/lib/split-validation";

export type SplitLegInput = { entityId: string; categoryId: string | null; amount: string };

function revalidateReview(entitySlug: string) {
  revalidatePath("/review");
  revalidatePath(`/review/${entitySlug}`);
  revalidatePath("/review/unclassified");
}

/**
 * Split a transaction into 2+ legs (each entity + category + amount). Validates against the REAL parent
 * amount, then applies via the atomic RPC (which re-validates sum-to-parent / same-sign / category∈entity
 * in one DB transaction — the authoritative guard). Service-role because setting split_at needs an UPDATE
 * on transactions, which has no authenticated policy.
 */
export async function splitTransaction(input: {
  transactionId: string;
  legs: SplitLegInput[];
  entitySlug: string;
}): Promise<{ success: true } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: tx, error: txError } = await supabase
    .from("transactions")
    .select("amount")
    .eq("id", input.transactionId)
    .maybeSingle();
  if (txError) return { error: txError.message };
  if (!tx) return { error: "Transaction not found" };

  const result = validateSplit(input.legs as SplitLegDraft[], Number(tx.amount));
  if (!result.ok) return { error: result.error };

  const admin = createServiceRoleClient();
  const { error } = await admin.rpc("apply_transaction_split", {
    p_transaction_id: input.transactionId,
    p_legs: result.legs.map((l) => ({
      entity_id: l.entityId,
      category_id: l.categoryId,
      amount: centsToNumber(l.amountCents),
    })),
  });
  if (error) return { error: error.message };

  revalidateReview(input.entitySlug);
  return { success: true };
}

export async function unsplitTransaction(input: {
  transactionId: string;
  entitySlug: string;
}): Promise<{ success: true } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const admin = createServiceRoleClient();
  const { error } = await admin.rpc("unsplit_transaction", {
    p_transaction_id: input.transactionId,
  });
  if (error) return { error: error.message };

  revalidateReview(input.entitySlug);
  return { success: true };
}

/**
 * Recategorize ONE split leg in place (the /reports/transactions inline editor). A leg row cannot
 * go through reclassifyTransaction: that writes the PARENT's classification, which is exactly the
 * record every report hides once a transaction is split - the edit would change an invisible row
 * and leave the visible leg untouched. Amounts are never touched here, so the legs-sum-to-parent
 * invariant (owned by the apply_transaction_split RPC) is not in play; the category is validated
 * against the LEG's own entity, mirroring the RPC's category-in-entity guard.
 */
export async function setSplitLegCategory(input: {
  legId: string;
  categoryId: string | null;
}): Promise<{ success: true } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  if (!isUuid(input.legId)) return { error: "Invalid leg id" };
  if (input.categoryId !== null && !isUuid(input.categoryId)) {
    return { error: "Invalid category id" };
  }

  const admin = createServiceRoleClient();

  const { data: leg, error: legError } = await admin
    .from("transaction_splits")
    .select("id, entity_id, entity:entities!inner(slug)")
    .eq("id", input.legId)
    .maybeSingle();
  if (legError || !leg) return { error: "Could not load that split leg" };

  if (input.categoryId !== null) {
    const { data: category, error: categoryError } = await admin
      .from("categories")
      .select("id")
      .eq("id", input.categoryId)
      .eq("entity_id", leg.entity_id as string)
      .maybeSingle();
    if (categoryError || !category) return { error: "That category doesn't belong to this entity" };
  }

  const { error } = await admin
    .from("transaction_splits")
    .update({ category_id: input.categoryId })
    .eq("id", input.legId);
  if (error) return { error: error.message };

  const slug = (leg as unknown as { entity: { slug: string } }).entity.slug;
  revalidateReview(slug);
  revalidatePath("/reports/transactions");
  revalidatePath("/transactions");
  return { success: true };
}
