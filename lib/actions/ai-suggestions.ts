"use server";

import { revalidatePath } from "next/cache";
import { estimateCostUsd } from "@/lib/ai/config";
import { classifyAllTransactions, estimateTokensForBatch } from "@/lib/ai/preclassify";
import type { BacklogTransaction } from "@/lib/ai/vendor-groups";
import { extractVendorSearchKey } from "@/lib/suggestions/category-suggestions";
import { logSuggestionEvent, type SuggestionOutcome } from "@/lib/actions/suggestion-events";
import {
  getEntityChartsForAi,
  getPersonalAiBacklog,
} from "@/lib/queries/ai-suggestions";
import { createClient } from "@/lib/supabase/server";

export type AiEstimateResult = {
  transactionCount: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number;
  batchCount: number;
};

export async function estimateAiRun(transactionIds: string[]): Promise<AiEstimateResult | { error: string }> {
  const backlog = await getPersonalAiBacklog();
  const allowed = new Set(backlog.map((tx) => tx.id));
  const count = transactionIds.filter((id) => allowed.has(id)).length;
  if (count === 0) return { error: "No eligible transactions selected" };

  const charts = await getEntityChartsForAi();
  const categoryCount = charts.reduce((sum, chart) => sum + chart.categoryPaths.length, 0);
  const { inputTokens, outputTokens } = estimateTokensForBatch(count, categoryCount);
  const batchCount = Math.ceil(count / 25);

  return {
    transactionCount: count,
    estimatedInputTokens: inputTokens,
    estimatedOutputTokens: outputTokens,
    estimatedCostUsd: estimateCostUsd(inputTokens, outputTokens),
    batchCount,
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

async function resolveCategoryId(entityId: string, categoryPath: string | null) {
  if (!categoryPath) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("categories")
    .select("id")
    .eq("entity_id", entityId)
    .eq("full_path", categoryPath)
    .maybeSingle();
  return data?.id ?? null;
}

export async function requestAiSuggestions(
  transactionIds: string[],
): Promise<AiRunResult | { error: string }> {
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

  const entityCharts = await getEntityChartsForAi();
  const { data: entities } = await supabase.from("entities").select("id, slug");
  const entityIdBySlug = new Map((entities ?? []).map((entity) => [entity.slug, entity.id]));

  const { items, inputTokens, outputTokens, model } = await classifyAllTransactions({
    transactions,
    entityCharts,
  });

  const staleIds = transactions.map((tx) => tx.id);
  if (staleIds.length > 0) {
    await supabase.from("ai_suggestions").update({ is_current: false }).in("transaction_id", staleIds);
  }

  const rows = [];
  for (const item of items) {
    const tx = backlogMap.get(item.transaction_id);
    if (!tx) continue;
    const entityId = entityIdBySlug.get(item.entity_slug);
    if (!entityId) continue;
    const categoryId = await resolveCategoryId(entityId, item.category_path);

    rows.push({
      transaction_id: item.transaction_id,
      vendor_group_key: extractVendorSearchKey(tx.description, tx.vendor),
      entity_id: entityId,
      entity_slug: item.entity_slug,
      suggested_category_id: categoryId,
      suggested_category_path: item.category_path,
      confidence: item.confidence,
      rationale: item.rationale,
      model,
      input_tokens: Math.round(inputTokens / items.length),
      output_tokens: Math.round(outputTokens / items.length),
      is_current: true,
    });
  }

  if (rows.length > 0) {
    const { error } = await supabase.from("ai_suggestions").insert(rows);
    if (error) return { error: error.message };
  }

  revalidatePath("/review/personal");
  revalidatePath("/reports/ai-suggestions");

  return {
    processed: rows.length,
    inputTokens,
    outputTokens,
    costUsd: estimateCostUsd(inputTokens, outputTokens),
    model,
  };
}

export type AcceptAiItem = {
  classificationId: string;
  transactionId: string;
  entityId: string;
  categoryId: string | null;
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

    const outcome: SuggestionOutcome = {
      transactionId: item.transactionId,
      classificationId: item.classificationId,
      entityId: item.entityId,
      description: item.description,
      vendor: item.vendor,
      chosenCategoryId: item.categoryId,
      suggestionsShown: item.categoryId
        ? [{ categoryId: item.categoryId, source: "ai_llm" }]
        : [],
    };
    await logSuggestionEvent(outcome, createdBy);
  }

  revalidatePath("/review");
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
