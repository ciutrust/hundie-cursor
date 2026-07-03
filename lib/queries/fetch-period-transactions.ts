import type { createClient } from "@/lib/supabase/server";
import { paginateAll } from "@/lib/supabase/paginate";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * OPT-08: one parameterized period-transaction fetcher behind the ~6 near-identical
 * hand-maintained fetchers (review / reports / report-analytics / entity-home). Each
 * caller supplies its own embed `select` + filters; this owns the pagination + ordering.
 * A UNIQUE `id` tiebreaker is ALWAYS applied so offset pagination is stable (never skips or
 * duplicates a row across pages on >1000-row periods); `order` additionally sorts by
 * `transaction_date` for display when the caller asks. The method-chaining order
 * (range before order/eq) is irrelevant to the emitted PostgREST query.
 */
export type FetchPeriodTransactionsOptions = {
  supabase: ServerClient;
  select: string;
  start: string;
  end: string;
  /** Filter on the embedded `classification.entity_id`. */
  entityId?: string;
  /** Filter on the embedded `classification.entity.slug`. */
  entitySlug?: string;
  /** Filter on the embedded `classification.category_id`. */
  categoryId?: string;
  /** Add a `transaction_date` primary display sort (with `id` tiebreaker); omit to page in stable `id` order only. */
  order?: "asc" | "desc";
};

export async function fetchPeriodTransactions<T>(
  opts: FetchPeriodTransactionsOptions,
): Promise<T[]> {
  const { supabase, select, start, end, entityId, entitySlug, categoryId, order } = opts;
  return paginateAll<T>(async (from, pageSize) => {
    let query = supabase
      .from("transactions")
      .select(select)
      .gte("transaction_date", start)
      .lt("transaction_date", end)
      .range(from, from + pageSize - 1);

    if (order) {
      const ascending = order === "asc";
      query = query.order("transaction_date", { ascending }).order("id", { ascending });
    } else {
      // Stability: always order by a UNIQUE column so offset pagination never skips/duplicates a row
      // across pages (>1000-row periods). Callers that don't care about display order still need this.
      query = query.order("id");
    }
    if (entityId) query = query.eq("classification.entity_id", entityId);
    if (entitySlug) query = query.eq("classification.entity.slug", entitySlug);
    if (categoryId) query = query.eq("classification.category_id", categoryId);

    const { data, error } = await query;
    return { data: data as T[] | null, error };
  });
}
