import type { createClient } from "@/lib/supabase/server";
import { paginateAll } from "@/lib/supabase/paginate";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * OPT-08: one parameterized period-transaction fetcher behind the ~6 near-identical
 * hand-maintained fetchers (review / reports / report-analytics / entity-home). Each
 * caller supplies its own embed `select` + filters; this owns the pagination + the
 * `transaction_date`/`id` ordering. Strictly behavior-preserving: omit `order` to skip
 * `.order()` entirely, matching callers that don't order. The method-chaining order
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
  /** `transaction_date` then `id`; omit to leave ordering to PostgREST defaults. */
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
    }
    if (entityId) query = query.eq("classification.entity_id", entityId);
    if (entitySlug) query = query.eq("classification.entity.slug", entitySlug);
    if (categoryId) query = query.eq("classification.category_id", categoryId);

    const { data, error } = await query;
    return { data: data as T[] | null, error };
  });
}
