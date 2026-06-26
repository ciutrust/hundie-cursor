import type { SupabaseClient } from "@supabase/supabase-js";

type PageResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

/** Fetch all rows from a Supabase query that uses `.range(from, to)`. */
export async function paginateAll<T>(
  buildQuery: (from: number, pageSize: number) => PromiseLike<PageResult<T>>,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await buildQuery(from, pageSize);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    all.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }

  return all;
}

export type SupabaseServerClient = SupabaseClient;
