"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import { categoryPairTemplate, suggestLinkKind, type LinkKind } from "@/lib/intercompany-pairing";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isUuid } from "@/lib/uuid";

/** Categorizing a leg changes the entity's review queue too, so those pages get busted by slug. */
function revalidatePairingSurfaces(entitySlugs: string[] = []) {
  revalidatePath("/reports/intercompany");
  revalidatePath("/review");
  for (const slug of new Set(entitySlugs)) revalidatePath(`/review/${slug}`);
  revalidatePath("/transactions");
}

type Admin = ReturnType<typeof createServiceRoleClient>;

type LegClassificationRow = {
  id: string;
  classification: {
    entity_id: string;
    category_id: string | null;
    entity: { slug: string };
  };
};

/**
 * Conditionally categorize one leg from the pair template. Never overwrites: the update carries
 * `.is("category_id", null)`, so a category set by the user (or by a concurrent write) between the
 * fetch and the update survives - the write simply matches zero rows. A template path that isn't
 * seeded for this entity is skipped silently: the link already succeeded, and a missing category
 * row must not turn a successful link into an error.
 */
async function categorizeIfBlank(
  admin: Admin,
  leg: LegClassificationRow,
  fullPath: string,
): Promise<boolean> {
  if (leg.classification.category_id != null) return false;

  const { data: category, error: categoryError } = await admin
    .from("categories")
    .select("id")
    .eq("entity_id", leg.classification.entity_id)
    .eq("full_path", fullPath)
    .maybeSingle();
  if (categoryError || !category) return false;

  const { data: updated, error: updateError } = await admin
    .from("classifications")
    .update({
      category_id: category.id as string,
      classified_at: new Date().toISOString(),
      classified_by: "intercompany-link",
    })
    .eq("transaction_id", leg.id)
    .is("category_id", null)
    .select("transaction_id");
  if (updateError) return false;
  return (updated?.length ?? 0) > 0;
}

/** Fetch both legs' booked entity + category state; null when either is unreadable. */
async function fetchLegs(
  admin: Admin,
  outId: string,
  inId: string,
): Promise<{ outLeg: LegClassificationRow; inLeg: LegClassificationRow } | null> {
  const { data: rows, error } = await admin
    .from("transactions")
    .select(
      "id, classification:classifications!inner(entity_id, category_id, entity:entities!inner(slug))",
    )
    .in("id", [outId, inId]);
  if (error || !rows) return null;

  const byId = new Map((rows as unknown as LegClassificationRow[]).map((row) => [row.id, row]));
  const outLeg = byId.get(outId);
  const inLeg = byId.get(inId);
  if (!outLeg || !inLeg) return null;
  return { outLeg, inLeg };
}

export type LinkIntercompanyPairInput = {
  outId: string;
  inId: string;
  /**
   * Advisory only. The kind that gets STORED and drives the category template is re-derived
   * server-side from the two legs' booked entities - the client's value previews the closest
   * candidate, which is not necessarily the one the user picked (review finding F1: trusting it
   * could file a real GBSL lease expense off-P&L as "Internal transfer").
   */
  kind?: LinkKind;
  refToken?: string | null;
};

export type LinkIntercompanyPairResult =
  | { success: true; kind: LinkKind; categorizedOut: boolean; categorizedIn: boolean }
  | { error: string };

/**
 * Confirm an out<->in transfer pair. The link itself goes through the RPC (service-role only, with
 * server-side guards that raise readable exceptions); the category template is applied after, and
 * only onto legs that are still uncategorized. Categorization is deliberately OUTSIDE the RPC:
 * the link is the money invariant, categorization is reversible bookkeeping - a categorization
 * hiccup must never roll back or fail an already-correct link.
 */
export async function linkIntercompanyPair(
  input: LinkIntercompanyPairInput,
): Promise<LinkIntercompanyPairResult> {
  const { error: authError, user } = await requireUser();
  if (authError) return { error: authError };

  if (!isUuid(input.outId) || !isUuid(input.inId)) return { error: "Invalid transaction id" };

  const admin = createServiceRoleClient();

  // Legs come first so the kind is derived from what the rows actually are, never from the client.
  const legs = await fetchLegs(admin, input.outId, input.inId);
  if (!legs) return { error: "Could not load both sides of the pair" };
  const outSlug = legs.outLeg.classification.entity.slug;
  const inSlug = legs.inLeg.classification.entity.slug;
  const kind = suggestLinkKind(outSlug, inSlug);

  const { data: linkId, error } = await admin.rpc("link_intercompany_pair", {
    p_out: input.outId,
    p_in: input.inId,
    p_kind: kind,
    p_ref_token: input.refToken ?? null,
  });
  if (error) return { error: error.message };

  // Attribution: the RPC runs as service role, so the acting user is stamped here.
  if (linkId) {
    await admin
      .from("intercompany_links")
      .update({ created_by: user?.email ?? user?.id ?? "unknown" })
      .eq("id", linkId as string);
  }

  const template = categoryPairTemplate(kind, outSlug, inSlug);
  const categorizedOut = template ? await categorizeIfBlank(admin, legs.outLeg, template.outPath) : false;
  const categorizedIn = template ? await categorizeIfBlank(admin, legs.inLeg, template.inPath) : false;

  revalidatePairingSurfaces([outSlug, inSlug]);
  return { success: true, kind, categorizedOut, categorizedIn };
}

/**
 * The bulk "Link all exact matches" path. Sequential on purpose: each link runs the RPC's guards
 * independently, so one bad pair fails alone instead of poisoning the batch.
 */
export async function linkIntercompanyPairs(input: {
  pairs: Array<{ outId: string; inId: string; kind?: LinkKind; refToken?: string | null }>;
}): Promise<{ linked: number; failed: number; firstError: string | null }> {
  // Shape guard: this is a POST endpoint. A malformed body should get a countable result, not an
  // unhandled TypeError; the cap keeps a giant batch from riding into a serverless timeout.
  if (!Array.isArray(input?.pairs)) return { linked: 0, failed: 0, firstError: "Invalid input" };
  if (input.pairs.length > 100) {
    return { linked: 0, failed: 0, firstError: "Too many pairs in one batch (max 100)" };
  }

  let linked = 0;
  let failed = 0;
  let firstError: string | null = null;

  for (const pair of input.pairs) {
    const result = await linkIntercompanyPair(pair);
    if ("error" in result) {
      failed += 1;
      if (firstError == null) firstError = result.error;
    } else {
      linked += 1;
    }
  }

  return { linked, failed, firstError };
}

/**
 * Remove a confirmed link. Categories the LINK wrote are reverted (guarded by
 * classified_by = 'intercompany-link', which reclassify overwrites the moment the user touches a
 * category by hand - so only untouched auto-filed legs revert, and hand-edited work is never
 * destroyed). Without this, a mislinked one-tap would leave a real expense silently filed off-P&L
 * after the unlink "fixed" it (review finding F4).
 */
export async function unlinkIntercompanyPair(input: {
  linkId: string;
}): Promise<{ success: true } | { error: string }> {
  const { error: authError } = await requireUser();
  if (authError) return { error: authError };

  if (!isUuid(input.linkId)) return { error: "Invalid link id" };

  const admin = createServiceRoleClient();

  // Read the legs before the RPC deletes the row.
  const { data: link } = await admin
    .from("intercompany_links")
    .select("out_transaction_id, in_transaction_id")
    .eq("id", input.linkId)
    .maybeSingle();

  const { error } = await admin.rpc("unlink_intercompany_pair", { p_link_id: input.linkId });
  if (error) return { error: error.message };

  if (link) {
    await admin
      .from("classifications")
      .update({ category_id: null, classified_at: null, classified_by: null })
      .in("transaction_id", [link.out_transaction_id as string, link.in_transaction_id as string])
      .eq("classified_by", "intercompany-link");
  }

  revalidatePairingSurfaces();
  return { success: true };
}

const MAX_LINK_NOTE_CHARS = 2000;

/**
 * The accounting trail on a PAIR (stored on the link row, not either leg): why the money moved,
 * anything Hannah or a QuickBooks export needs later. Empty clears it.
 */
export async function setIntercompanyLinkNote(input: {
  linkId: string;
  note: string;
}): Promise<{ success: true } | { error: string }> {
  const { error: authError } = await requireUser();
  if (authError) return { error: authError };

  if (!isUuid(input.linkId)) return { error: "Invalid link id" };
  const note = (input.note ?? "").trim();
  if (note.length > MAX_LINK_NOTE_CHARS) {
    return { error: `Note can't exceed ${MAX_LINK_NOTE_CHARS} characters` };
  }

  const admin = createServiceRoleClient();
  const { error } = await admin
    .from("intercompany_links")
    .update({ note: note || null })
    .eq("id", input.linkId);
  if (error) return { error: error.message };

  revalidatePath("/reports/intercompany");
  return { success: true };
}

/**
 * Recategorize one leg of a linked pair without leaving the pairing page. Same write the review
 * flow makes (classified_by = the user, so the unlink revert guard correctly treats it as
 * hand-set from here on), with the category validated against the leg's booked entity - a GBSL
 * row can never receive a Personal category.
 */
export async function setPairLegCategory(input: {
  transactionId: string;
  categoryId: string | null;
}): Promise<{ success: true } | { error: string }> {
  const { error: authError, user } = await requireUser();
  if (authError) return { error: authError };

  if (!isUuid(input.transactionId)) return { error: "Invalid transaction id" };
  if (input.categoryId !== null && !isUuid(input.categoryId)) {
    return { error: "Invalid category id" };
  }

  const admin = createServiceRoleClient();

  const { data: cls, error: clsError } = await admin
    .from("classifications")
    .select("id, entity_id, entity:entities!inner(slug)")
    .eq("transaction_id", input.transactionId)
    .maybeSingle();
  if (clsError || !cls) return { error: "Could not load that transaction" };

  if (input.categoryId !== null) {
    const { data: category, error: catError } = await admin
      .from("categories")
      .select("id")
      .eq("id", input.categoryId)
      .eq("entity_id", cls.entity_id as string)
      .maybeSingle();
    if (catError || !category) return { error: "That category doesn't belong to this entity" };
  }

  const { error } = await admin
    .from("classifications")
    .update({
      category_id: input.categoryId,
      classified_at: input.categoryId === null ? null : new Date().toISOString(),
      classified_by: input.categoryId === null ? null : (user?.email ?? user?.id ?? "unknown"),
    })
    .eq("transaction_id", input.transactionId);
  if (error) return { error: error.message };

  const slug = (cls as unknown as { entity: { slug: string } }).entity.slug;
  revalidatePairingSurfaces([slug]);
  return { success: true };
}

/**
 * "The counterpart isn't tracked in Hundie" - resolves a one-sided leg for good (the Way2Save
 * savings, Three Cities Trust class of rows). The optional note is the accounting trail.
 */
export async function acknowledgeOneSidedLeg(input: {
  transactionId: string;
  note?: string;
}): Promise<{ success: true } | { error: string }> {
  const { error: authError, user } = await requireUser();
  if (authError) return { error: authError };

  if (!isUuid(input.transactionId)) return { error: "Invalid transaction id" };
  const note = (input.note ?? "").trim();
  if (note.length > MAX_LINK_NOTE_CHARS) {
    return { error: `Note can't exceed ${MAX_LINK_NOTE_CHARS} characters` };
  }

  const admin = createServiceRoleClient();
  const { error } = await admin.from("intercompany_one_sided_acks").upsert(
    {
      transaction_id: input.transactionId,
      note: note || null,
      acked_by: user?.email ?? user?.id ?? "unknown",
    },
    { onConflict: "transaction_id" },
  );
  if (error) return { error: error.message };

  revalidatePath("/reports/intercompany");
  return { success: true };
}

/** Undo an acknowledgment - the leg returns to the One-sided list. */
export async function unacknowledgeOneSidedLeg(input: {
  transactionId: string;
}): Promise<{ success: true } | { error: string }> {
  const { error: authError } = await requireUser();
  if (authError) return { error: authError };

  if (!isUuid(input.transactionId)) return { error: "Invalid transaction id" };

  const admin = createServiceRoleClient();
  const { error } = await admin
    .from("intercompany_one_sided_acks")
    .delete()
    .eq("transaction_id", input.transactionId);
  if (error) return { error: error.message };

  revalidatePath("/reports/intercompany");
  return { success: true };
}

/** "These two are not a pair" - suppresses the suggestion for good. Idempotent by design. */
export async function dismissIntercompanyPair(input: {
  outId: string;
  inId: string;
}): Promise<{ success: true } | { error: string }> {
  const { error: authError } = await requireUser();
  if (authError) return { error: authError };

  if (!isUuid(input.outId) || !isUuid(input.inId)) return { error: "Invalid transaction id" };

  const admin = createServiceRoleClient();
  const { error } = await admin
    .from("intercompany_pair_dismissals")
    .upsert(
      { out_transaction_id: input.outId, in_transaction_id: input.inId },
      { onConflict: "out_transaction_id,in_transaction_id", ignoreDuplicates: true },
    );
  if (error) return { error: error.message };

  // Dismissals only change what the pairing report suggests - no other surface renders them.
  revalidatePath("/reports/intercompany");
  return { success: true };
}
