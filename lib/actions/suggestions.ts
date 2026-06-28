"use server";

import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import {
  rankAmountAwareMatches,
  representativeBulkAmount,
  type AmountHistoryRow,
} from "@/lib/suggestions/amount-aware-ranking";
import { mergeWeightedSuggestions } from "@/lib/suggestions/blend-ranking";
import {
  escapeIlikePattern,
  extractSearchTokens,
  extractSearchTokensFromTransactions,
  extractVendorSearchKey,
  shouldSuggestBulkCategories,
  shouldSuggestCategories,
  type BulkCategorySuggestionInput,
  type CategorySuggestion,
  type CategorySuggestionInput,
} from "@/lib/suggestions/category-suggestions";

type LedgerRow = AmountHistoryRow & {
  transaction_date: string;
  description: string;
  vendor: string | null;
};

async function getEntityId(slug: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("entities").select("id").eq("slug", slug).single();
  if (error || !data) return null;
  return data.id;
}

async function fetchQbTrainingRows(entityId: string, tokens: string[]) {
  const supabase = await createClient();
  if (tokens.length === 0) return [];

  const orFilters = tokens.flatMap((token) => {
    const pattern = escapeIlikePattern(token);
    return [`vendor_name.ilike.%${pattern}%`, `description.ilike.%${pattern}%`];
  });

  const { data, error } = await supabase
    .from("qb_training_expenses")
    .select("category_id, category_name")
    .eq("entity_id", entityId)
    .or(orFilters.join(","));

  if (error) throw new Error(error.message);
  return data ?? [];
}

async function fetchLedgerRows(entityId: string, tokens: string[]): Promise<LedgerRow[]> {
  const supabase = await createClient();
  if (tokens.length === 0) return [];

  const orFilters = tokens.flatMap((token) => {
    const pattern = escapeIlikePattern(token);
    return [`vendor.ilike.%${pattern}%`, `description.ilike.%${pattern}%`];
  });

  const { data, error } = await supabase
    .from("transactions")
    .select(
      `
      amount,
      description,
      vendor,
      transaction_date,
      classification:classifications!inner(
        category_id,
        entity_id,
        category:categories(id, full_path)
      )
    `,
    )
    .eq("classification.entity_id", entityId)
    .not("classification.category_id", "is", null)
    .or(orFilters.join(","));

  if (error) throw new Error(error.message);

  return (
    data?.map((row) => ({
      amount: Number(row.amount),
      description: row.description,
      vendor: row.vendor,
      category_id: row.classification.category_id,
      category: row.classification.category,
      transaction_date: row.transaction_date,
    })) ?? []
  );
}

async function fetchSuggestionEventRows(entityId: string, tokens: string[]) {
  const supabase = await createClient();
  if (tokens.length === 0) return [];

  const { data, error } = await supabase
    .from("suggestion_events")
    .select(
      `
      suggested_category_id,
      chosen_category_id,
      event_type,
      vendor_key,
      created_at,
      category:categories!suggestion_events_suggested_category_id_fkey(id, full_path),
      chosen:categories!suggestion_events_chosen_category_id_fkey(id, full_path)
    `,
    )
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    if (error.message.includes("suggestion_events")) return [];
    throw new Error(error.message);
  }

  return (data ?? []).filter((row) =>
    tokens.some((token) => row.vendor_key.toLowerCase().includes(token.toLowerCase())),
  );
}

function filterLedgerRowsByVendorKey(ledgerRows: LedgerRow[], vendorKey: string): AmountHistoryRow[] {
  if (!vendorKey) return ledgerRows;

  return ledgerRows.filter(
    (row) => extractVendorSearchKey(row.description, row.vendor) === vendorKey,
  );
}

async function fetchBlendedSuggestions(
  entitySlug: string,
  tokens: string[],
  options?: { amount?: number; vendorKey?: string },
) {
  const entityId = await getEntityId(entitySlug);
  if (!entityId) {
    return { suggestions: [], error: `${entitySlug} entity not found` };
  }

  try {
    const [qbRows, ledgerRows, eventRows] = await Promise.all([
      entitySlug === "gbsl" ? fetchQbTrainingRows(entityId, tokens) : Promise.resolve([]),
      fetchLedgerRows(entityId, tokens),
      fetchSuggestionEventRows(entityId, tokens),
    ]);

    const vendorKey = options?.vendorKey ?? "";
    const vendorLedgerRows = filterLedgerRowsByVendorKey(ledgerRows, vendorKey);
    const amountAwareMatches =
      options?.amount != null && vendorLedgerRows.length > 0
        ? rankAmountAwareMatches(options.amount, vendorLedgerRows)
        : [];

    return {
      suggestions: mergeWeightedSuggestions(
        qbRows,
        ledgerRows,
        eventRows,
        amountAwareMatches,
      ),
    };
  } catch (error) {
    return {
      suggestions: [],
      error: error instanceof Error ? error.message : "Failed to load suggestions",
    };
  }
}

export async function getCategorySuggestions(
  input: CategorySuggestionInput,
): Promise<{ suggestions: CategorySuggestion[]; error?: string }> {
  // SEC-05: explicit auth guard (defense-in-depth on top of RLS).
  const { error: authError } = await requireUser();
  if (authError) return { suggestions: [], error: authError };

  if (!shouldSuggestCategories(input)) {
    return { suggestions: [] };
  }

  const tokens = extractSearchTokens(input.description, input.vendor);
  const vendorKey = extractVendorSearchKey(input.description, input.vendor);

  return fetchBlendedSuggestions(input.entitySlug, tokens, {
    amount: input.amount,
    vendorKey,
  });
}

export async function getBulkCategorySuggestions(
  input: BulkCategorySuggestionInput,
): Promise<{ suggestions: CategorySuggestion[]; error?: string }> {
  // SEC-05: explicit auth guard (defense-in-depth on top of RLS).
  const { error: authError } = await requireUser();
  if (authError) return { suggestions: [], error: authError };

  if (!shouldSuggestBulkCategories(input)) {
    return { suggestions: [] };
  }

  const tokens = extractSearchTokensFromTransactions(input.transactions);
  const sample = input.transactions[0];
  const vendorKey = sample
    ? extractVendorSearchKey(sample.description, sample.vendor)
    : "";
  const bulkAmount = representativeBulkAmount(
    input.transactions
      .map((tx) => tx.amount)
      .filter((amount): amount is number => amount != null),
  );

  return fetchBlendedSuggestions(input.entitySlug, tokens, {
    amount: bulkAmount,
    vendorKey,
  });
}

/**
 * Top suggestion per vendor, for the inline one-click pills on the Classify list.
 * The caller dedupes to unique vendor keys (ordered by frequency); we cap the fan-out so a huge
 * backlog can't fire hundreds of queries. Rows without a pill still classify via the dialog.
 */
export async function getInlineCategorySuggestions(input: {
  entitySlug: string;
  vendors: Array<{ vendorKey: string; description: string; vendor: string | null; amount: number }>;
}): Promise<{ suggestions: Record<string, CategorySuggestion | null> }> {
  // SEC-05: explicit auth guard (defense-in-depth on top of RLS). The return
  // shape has no error field, so fail closed to an empty suggestion map.
  const { error: authError } = await requireUser();
  if (authError) return { suggestions: {} };

  const top = input.vendors.slice(0, 50);
  const entries = await Promise.all(
    top.map(async (vendor) => {
      const result = await getCategorySuggestions({
        description: vendor.description,
        vendor: vendor.vendor,
        entitySlug: input.entitySlug,
        amount: vendor.amount,
      });
      return [vendor.vendorKey, result.suggestions[0] ?? null] as const;
    }),
  );
  return { suggestions: Object.fromEntries(entries) };
}

export { extractVendorSearchKey };
