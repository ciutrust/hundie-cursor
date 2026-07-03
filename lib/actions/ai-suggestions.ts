"use server";

import { revalidatePath } from "next/cache";
import { estimateCostUsd, getAiModel } from "@/lib/ai/config";
import { packagesForTransactionIds } from "@/lib/ai/vendor-group-packages";
import {
  classifyAllVendorGroups,
  estimateTokensForVendorGroups,
} from "@/lib/ai/vendor-group-classify";
import type { BacklogTransaction } from "@/lib/ai/vendor-groups";
import { logSuggestionEvent, type SuggestionOutcome } from "@/lib/actions/suggestion-events";
import { requireUser } from "@/lib/auth/require-user";
import {
  getEntityChartsForAi,
  getPersonalAiBacklog,
} from "@/lib/queries/ai-suggestions";
import { createClient } from "@/lib/supabase/server";

export type AiEstimateResult = {
  transactionCount: number;
  vendorGroupCount: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number;
  batchCount: number;
  model: string;
};

export async function estimateAiRun(transactionIds: string[]): Promise<AiEstimateResult | { error: string }> {
  // SEC-05: explicit auth guard (defense-in-depth on top of RLS) before reading the backlog.
  const { error: authError } = await requireUser();
  if (authError) return { error: authError };

  const backlog = await getPersonalAiBacklog();
  const allowed = new Set(backlog.map((tx) => tx.id));
  const eligibleIds = transactionIds.filter((id) => allowed.has(id));
  const eligible = backlog.filter((tx) => eligibleIds.includes(tx.id));
  if (eligible.length === 0) return { error: "No eligible transactions selected" };

  const packages = packagesForTransactionIds(backlog, eligible.map((tx) => tx.id));
  const charts = await getEntityChartsForAi();
  const categoryCount = charts.reduce((sum, chart) => sum + chart.categoryPaths.length, 0);
  const { inputTokens, outputTokens } = estimateTokensForVendorGroups(packages.length, categoryCount);
  const batchCount = Math.ceil(packages.length / 25);

  return {
    transactionCount: eligible.length,
    vendorGroupCount: packages.length,
    estimatedInputTokens: inputTokens,
    estimatedOutputTokens: outputTokens,
    estimatedCostUsd: estimateCostUsd(inputTokens, outputTokens),
    batchCount,
    model: getAiModel(),
  };
}

export type AiRunResult = {
  processed: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  model: string;
};

async function loadBacklogMap() {
  const backlog = await getPersonalAiBacklog();
  return new Map(backlog.map((tx) => [tx.id, tx]));
}

async function loadCategoryLookup() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .select("id, entity_id, full_path")
    .eq("is_active", true);

  if (error) throw error;

  const lookup = new Map<string, string>();
  for (const row of data ?? []) {
    lookup.set(`${row.entity_id}:${row.full_path}`, row.id);
  }
  return lookup;
}

function resolveCategoryIdFromLookup(
  lookup: Map<string, string>,
  entityId: string,
  categoryPath: string | null,
) {
  if (!categoryPath) return null;
  return lookup.get(`${entityId}:${categoryPath}`) ?? null;
}

export async function requestAiSuggestions(
  transactionIds: string[],
): Promise<AiRunResult | { error: string }> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated" };

    const backlogMap = await loadBacklogMap();
    const transactions: BacklogTransaction[] = transactionIds
      .map((id) => backlogMap.get(id))
      .filter((tx): tx is BacklogTransaction => tx != null);

    if (transactions.length === 0) {
      return { error: "No eligible Personal uncategorized transactions in 2025–2026" };
    }

    const packages = packagesForTransactionIds(
      [...backlogMap.values()],
      transactions.map((tx) => tx.id),
    );

    if (packages.length === 0) {
      return { error: "No vendor groups to classify" };
    }

    const entityCharts = await getEntityChartsForAi();
    const { data: entities } = await supabase.from("entities").select("id, slug");
    const entityIdBySlug = new Map((entities ?? []).map((entity) => [entity.slug, entity.id]));

    const { items, inputTokens, outputTokens, model } = await classifyAllVendorGroups(
      packages,
      entityCharts,
    );

    const staleIds = transactions.map((tx) => tx.id);
    if (staleIds.length > 0) {
      await supabase.from("ai_suggestions").update({ is_current: false }).in("transaction_id", staleIds);
    }

    const packageByKey = new Map(packages.map((pkg) => [pkg.vendor_key, pkg]));
    const categoryLookup = await loadCategoryLookup();
    const rows = [];

    for (const item of items) {
      const pkg = packageByKey.get(item.vendor_key);
      if (!pkg) continue;
      const entityId = entityIdBySlug.get(item.entity_slug);
      if (!entityId) continue;
      const categoryId = resolveCategoryIdFromLookup(categoryLookup, entityId, item.category_path);

      for (const txId of pkg.transaction_ids) {
        const tx = backlogMap.get(txId);
        if (!tx) continue;
        rows.push({
          transaction_id: txId,
          vendor_group_key: item.vendor_key,
          entity_id: entityId,
          entity_slug: item.entity_slug,
          suggested_category_id: categoryId,
          suggested_category_path: item.category_path,
          confidence: item.confidence,
          rationale: item.rationale,
          model,
          input_tokens: 0,
          output_tokens: 0,
          is_current: true,
        });
      }
    }

    const perRowIn = rows.length > 0 ? Math.round(inputTokens / rows.length) : 0;
    const perRowOut = rows.length > 0 ? Math.round(outputTokens / rows.length) : 0;
    for (const row of rows) {
      row.input_tokens = perRowIn;
      row.output_tokens = perRowOut;
    }

    if (rows.length > 0) {
      const { error } = await supabase.from("ai_suggestions").insert(rows);
      if (error) return { error: error.message };
    }

    revalidatePath("/review/ai");
    revalidatePath("/review/personal");
    revalidatePath("/reports/ai-suggestions");

    return {
      processed: rows.length,
      inputTokens,
      outputTokens,
      costUsd: estimateCostUsd(inputTokens, outputTokens),
      model,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI run failed";
    return { error: message };
  }
}

export type AcceptAiItem = {
  classificationId: string;
  transactionId: string;
  entityId: string;
  /** The category being assigned (the AI's pick, or the operator's override). */
  categoryId: string | null;
  /** What the AI originally suggested — logged as the "shown" suggestion so keeping it
   *  records an accept and overriding it records a reject (honest accept-rate-by-source). */
  aiSuggestedCategoryId: string | null;
  description: string;
  vendor: string | null;
};

export async function acceptAiSuggestions(
  items: AcceptAiItem[],
): Promise<{ success: true; count: number } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  if (items.length === 0) return { error: "Nothing selected to accept" };

  const createdBy = user.email ?? user.id;

  // S4: guard that each assigned category belongs to its entity — the same invariant every other
  // writer enforces (reclassify.ts, proposals.ts). RLS's blanket USING(true) won't catch a
  // cross-entity write, so validate up front and fail closed before touching any classification.
  const categoryIds = [
    ...new Set(items.map((i) => i.categoryId).filter((id): id is string => id != null)),
  ];
  if (categoryIds.length > 0) {
    const { data: catRows, error: catErr } = await supabase
      .from("categories")
      .select("id, entity_id")
      .in("id", categoryIds);
    if (catErr) return { error: catErr.message };
    const entityByCategory = new Map((catRows ?? []).map((c) => [c.id, c.entity_id]));
    for (const item of items) {
      if (item.categoryId && entityByCategory.get(item.categoryId) !== item.entityId) {
        return { error: "Category does not belong to the selected entity" };
      }
    }
  }

  const acceptedTxIds: string[] = [];

  for (const item of items) {
    const { error } = await supabase
      .from("classifications")
      .update({
        entity_id: item.entityId,
        category_id: item.categoryId,
        classified_by: createdBy,
        classified_at: new Date().toISOString(),
      })
      .eq("id", item.classificationId);

    if (error) return { error: error.message };

    acceptedTxIds.push(item.transactionId);

    const outcome: SuggestionOutcome = {
      transactionId: item.transactionId,
      classificationId: item.classificationId,
      entityId: item.entityId,
      description: item.description,
      vendor: item.vendor,
      chosenCategoryId: item.categoryId,
      // Log the AI's ORIGINAL suggestion as what was shown — so keeping it logs an
      // accept and overriding it logs a reject (which still trains the engine on the
      // chosen category via confirmed history + the reject-credits-chosen rule).
      suggestionsShown: item.aiSuggestedCategoryId
        ? [{ categoryId: item.aiSuggestedCategoryId, source: "ai_llm" }]
        : [],
    };
    await logSuggestionEvent(outcome, createdBy);
  }

  if (acceptedTxIds.length > 0) {
    await supabase
      .from("ai_suggestions")
      .update({ is_current: false })
      .in("transaction_id", acceptedTxIds)
      .eq("is_current", true);
  }

  revalidatePath("/review");
  revalidatePath("/review/ai");
  revalidatePath("/review/personal");
  revalidatePath("/reports/ai-suggestions");

  return { success: true, count: items.length };
}

export async function rejectAiSuggestions(
  transactionIds: string[],
): Promise<{ success: true } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const backlogMap = await loadBacklogMap();
  const createdBy = user.email ?? user.id;

  for (const txId of transactionIds) {
    const tx = backlogMap.get(txId);
    if (!tx?.ai_suggestion) continue;

    const { data: entity } = await supabase
      .from("entities")
      .select("id")
      .eq("slug", tx.ai_suggestion.entity_slug)
      .single();

    if (!entity) continue;

    await logSuggestionEvent(
      {
        transactionId: tx.id,
        classificationId: tx.classification_id,
        entityId: entity.id,
        description: tx.description,
        vendor: tx.vendor,
        chosenCategoryId: null,
        suggestionsShown: tx.ai_suggestion.suggested_category_id
          ? [{ categoryId: tx.ai_suggestion.suggested_category_id, source: "ai_llm" }]
          : [],
      },
      createdBy,
    );
  }

  revalidatePath("/reports/ai-suggestions");
  return { success: true };
}
