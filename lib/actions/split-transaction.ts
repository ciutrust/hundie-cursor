"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { centsToNumber } from "@/lib/money";
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
