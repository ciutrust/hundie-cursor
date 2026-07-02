import type { SupabaseClient } from "@supabase/supabase-js";

type PageResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

/**
 * Fetch all rows from a Supabase query that uses `.range(from, to)`, following pages until a short one.
 *
 * IMPORTANT — offset pagination is only correct if the query applies a UNIQUE, stable `.order(...)`
 * (e.g. `.order("id")` as the final tiebreaker). Without one, rows that tie on the sort column can be
 * silently skipped or duplicated across page boundaries once the result exceeds one page
 * (the recurring BUG-05 / C7 / C10 class). New callers should always order by a unique column.
 *
 * Pass `key` to have this helper ENFORCE that at runtime: it throws loudly the moment a row is seen on
 * two pages (the signature of a missing/non-unique tiebreaker) instead of returning corrupt data. When
 * you can key rows (the query selects a unique column such as `id`), passing it is strongly recommended.
 */
export async function paginateAll<T>(
  buildQuery: (from: number, pageSize: number) => PromiseLike<PageResult<T>>,
  pageSize = 1000,
  key?: (row: T) => string | number,
): Promise<T[]> {
  const all: T[] = [];
  const seen = key ? new Set<string | number>() : null;
  let from = 0;

  while (true) {
    const { data, error } = await buildQuery(from, pageSize);
    if (error) throw new Error(error.message);
    const page = data ?? [];

    if (seen) {
      for (const row of page) {
        const k = key!(row);
        if (seen.has(k)) {
          throw new Error(
            `paginateAll: row key ${JSON.stringify(k)} returned on two pages — the query needs a ` +
              `unique .order() tiebreaker (e.g. .order("id")) for stable offset pagination.`,
          );
        }
        seen.add(k);
      }
    }

    all.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }

  return all;
}

export type SupabaseServerClient = SupabaseClient;
