import { AI_BACKLOG_END, AI_BACKLOG_START, AI_ENTITY_SLUG } from "@/lib/ai/config";
import type { BacklogTransaction } from "@/lib/ai/vendor-groups";
import { createClient } from "@/lib/supabase/server";

function isMissingAiSuggestionsTable(error: { message?: string } | null) {
  const message = error?.message?.toLowerCase() ?? "";
  return message.includes("ai_suggestions") && (message.includes("does not exist") || message.includes("schema cache"));
}

async function getPersonalEntityId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data } = await supabase.from("entities").select("id").eq("slug", AI_ENTITY_SLUG).single();
  return data?.id ?? null;
}

async function countPersonalUncategorizedBacklog(
  supabase: Awaited<ReturnType<typeof createClient>>,
  personalId: string,
) {
  const { count, error } = await supabase
    .from("transactions")
    .select("id, classification:classifications!inner(category_id)", { count: "exact", head: true })
    .eq("classification.entity_id", personalId)
    .is("classification.category_id", null)
    .gte("transaction_date", AI_BACKLOG_START)
    .lt("transaction_date", AI_BACKLOG_END);

  if (error) throw error;
  return count ?? 0;
}

async function listCurrentAiSuggestionTransactionIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<string[]> {
  const ids: string[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("ai_suggestions")
      .select("transaction_id")
      .eq("is_current", true)
      .range(from, from + 999);

    if (error) {
      if (isMissingAiSuggestionsTable(error)) return [];
      throw error;
    }
    if (!data?.length) break;

    ids.push(...data.map((row) => row.transaction_id));
    if (data.length < 1000) break;
    from += 1000;
  }

  return ids;
}

async function countBacklogMatches(
  supabase: Awaited<ReturnType<typeof createClient>>,
  personalId: string,
  transactionIds: string[],
) {
  let total = 0;

  for (let i = 0; i < transactionIds.length; i += 200) {
    const chunk = transactionIds.slice(i, i + 200);
    const { count, error } = await supabase
      .from("transactions")
      .select("id, classification:classifications!inner(category_id, entity_id)", {
        count: "exact",
        head: true,
      })
      .in("id", chunk)
      .eq("classification.entity_id", personalId)
      .is("classification.category_id", null)
      .gte("transaction_date", AI_BACKLOG_START)
      .lt("transaction_date", AI_BACKLOG_END);

    if (error) throw error;
    total += count ?? 0;
  }

  return total;
}

const BACKLOG_SELECT = `
  id,
  transaction_date,
  amount,
  description,
  vendor,
  account:accounts!inner(slug, display_name, default_entity_id, date_rules, default_entity:entities!accounts_default_entity_id_fkey(slug)),
  classification:classifications!inner(
    id,
    entity_id,
    category_id,
    entity:entities!inner(slug)
  )
`;

function resolveDefaultEntitySlug(
  account: {
    default_entity: { slug: string } | null;
    date_rules: unknown;
  },
  transactionDate: string,
): string | null {
  const rules = Array.isArray(account.date_rules) ? account.date_rules : [];
  for (const rule of rules as Array<{ until?: string; from?: string; entity_slug?: string }>) {
    if (rule.until && transactionDate <= rule.until && rule.entity_slug) return rule.entity_slug;
    if (rule.from && transactionDate >= rule.from && rule.entity_slug) return rule.entity_slug;
  }
  return account.default_entity?.slug ?? null;
}

export async function getPersonalAiBacklog(): Promise<BacklogTransaction[]> {
  const supabase = await createClient();

  const { data: personal } = await supabase.from("entities").select("id").eq("slug", AI_ENTITY_SLUG).single();
  if (!personal) return [];

  const pageSize = 1000;
  const all: BacklogTransaction[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("transactions")
      .select(BACKLOG_SELECT)
      .eq("classification.entity_id", personal.id)
      .is("classification.category_id", null)
      .gte("transaction_date", AI_BACKLOG_START)
      .lt("transaction_date", AI_BACKLOG_END)
      .order("transaction_date")
      .order("id")
      .range(from, from + pageSize - 1);

    if (error) throw error;
    if (!data?.length) break;

    const ids = data.map((row) => row.id);
    const aiByTx = new Map<
      string,
      {
        transaction_id: string;
        entity_slug: string;
        suggested_category_id: string | null;
        suggested_category_path: string | null;
        confidence: string;
        rationale: string;
      }
    >();

    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const { data: aiRows, error: aiError } = await supabase
        .from("ai_suggestions")
        .select(
          "transaction_id, entity_slug, suggested_category_id, suggested_category_path, confidence, rationale",
        )
        .in("transaction_id", chunk)
        .eq("is_current", true);

      if (aiError) {
        if (isMissingAiSuggestionsTable(aiError)) break;
        throw aiError;
      }
      for (const row of aiRows ?? []) {
        aiByTx.set(row.transaction_id, row);
      }
    }

    for (const row of data) {
      const ai = aiByTx.get(row.id);
      all.push({
        id: row.id,
        transaction_date: row.transaction_date,
        amount: Number(row.amount),
        description: row.description,
        vendor: row.vendor,
        account_slug: row.account.slug,
        account_display_name: row.account.display_name,
        current_entity_slug: row.classification.entity.slug,
        default_entity_slug: resolveDefaultEntitySlug(row.account, row.transaction_date),
        classification_id: row.classification.id,
        ai_suggestion: ai
          ? {
              entity_slug: ai.entity_slug,
              suggested_category_id: ai.suggested_category_id,
              suggested_category_path: ai.suggested_category_path,
              confidence: ai.confidence,
              rationale: ai.rationale,
            }
          : null,
      });
    }

    if (data.length < pageSize) break;
    from += pageSize;
  }

  return all;
}

export async function getEntityChartsForAi() {
  const supabase = await createClient();
  const { data: entities, error: entityError } = await supabase
    .from("entities")
    .select("id, slug, name")
    .eq("is_classifiable", true)
    .order("display_order");

  if (entityError) throw entityError;

  const { data: categories, error: catError } = await supabase
    .from("categories")
    .select("entity_id, full_path")
    .eq("is_active", true)
    .order("full_path");

  if (catError) throw catError;

  return (entities ?? []).map((entity) => ({
    slug: entity.slug,
    name: entity.name,
    categoryPaths: (categories ?? [])
      .filter((cat) => cat.entity_id === entity.id)
      .map((cat) => cat.full_path),
  }));
}

export async function getAiSuggestionForTransaction(transactionId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_suggestions")
    .select("*")
    .eq("transaction_id", transactionId)
    .eq("is_current", true)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export type AiAcceptanceRow = {
  entity_slug: string;
  confidence: string;
  shown: number;
  accepted: number;
  rejected: number;
  accept_rate: number;
};

export async function getAiAcceptanceStats(): Promise<AiAcceptanceRow[]> {
  const supabase = await createClient();

  const { data: events, error } = await supabase
    .from("suggestion_events")
    .select(
      `
      event_type,
      entity:entities!suggestion_events_entity_id_fkey(slug),
      transaction_id
    `,
    )
    .eq("suggestion_source", "ai_llm")
    .order("created_at", { ascending: false });

  if (error) throw error;

  const txIds = [...new Set((events ?? []).map((e) => e.transaction_id).filter(Boolean))] as string[];
  const confidenceByTx = new Map<string, string>();

  if (txIds.length > 0) {
    for (let i = 0; i < txIds.length; i += 200) {
      const chunk = txIds.slice(i, i + 200);
      const { data: aiRows } = await supabase
        .from("ai_suggestions")
        .select("transaction_id, confidence")
        .in("transaction_id", chunk);
      for (const row of aiRows ?? []) {
        confidenceByTx.set(row.transaction_id, row.confidence);
      }
    }
  }

  const buckets = new Map<string, { shown: number; accepted: number; rejected: number }>();

  for (const event of events ?? []) {
    const entitySlug = event.entity?.slug ?? "unknown";
    const confidence = confidenceByTx.get(event.transaction_id ?? "") ?? "unknown";
    const key = `${entitySlug}|${confidence}`;
    const bucket = buckets.get(key) ?? { shown: 0, accepted: 0, rejected: 0 };
    bucket.shown += 1;
    if (event.event_type === "accept") bucket.accepted += 1;
    if (event.event_type === "reject") bucket.rejected += 1;
    buckets.set(key, bucket);
  }

  return [...buckets.entries()]
    .map(([key, stats]) => {
      const [entity_slug, confidence] = key.split("|");
      return {
        entity_slug,
        confidence,
        shown: stats.shown,
        accepted: stats.accepted,
        rejected: stats.rejected,
        accept_rate: stats.shown > 0 ? stats.accepted / stats.shown : 0,
      };
    })
    .sort((a, b) => b.shown - a.shown);
}

/** Personal uncategorized backlog rows with a current AI suggestion awaiting confirm. */
export async function getAiPreclassifiedCount(): Promise<number> {
  try {
    const supabase = await createClient();
    const personalId = await getPersonalEntityId(supabase);
    if (!personalId) return 0;

    const txIds = await listCurrentAiSuggestionTransactionIds(supabase);
    if (txIds.length === 0) return 0;

    return countBacklogMatches(supabase, personalId, txIds);
  } catch (error) {
    if (isMissingAiSuggestionsTable(error as { message?: string })) return 0;
    console.error("getAiPreclassifiedCount failed:", error);
    return 0;
  }
}

export async function getAiSuggestionCoverage() {
  try {
    const supabase = await createClient();
    const personalId = await getPersonalEntityId(supabase);
    if (!personalId) return { total: 0, withAi: 0, withoutAi: 0 };

    const [total, txIds] = await Promise.all([
      countPersonalUncategorizedBacklog(supabase, personalId),
      listCurrentAiSuggestionTransactionIds(supabase),
    ]);
    const withAi =
      txIds.length === 0 ? 0 : await countBacklogMatches(supabase, personalId, txIds);

    return { total, withAi, withoutAi: total - withAi };
  } catch (error) {
    if (isMissingAiSuggestionsTable(error as { message?: string })) {
      return { total: 0, withAi: 0, withoutAi: 0 };
    }
    throw error;
  }
}
