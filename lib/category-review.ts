import type { SupabaseClient } from "@supabase/supabase-js";

/** Categories QB/CPA assigned that still need Alex review in Hundie. */
export const CPA_REVIEW_CATEGORY_PATHS = new Set(["Ask My Accountant"]);

export function isCpaReviewCategory(fullPath: string | null | undefined) {
  return fullPath != null && CPA_REVIEW_CATEGORY_PATHS.has(fullPath);
}

export function needsCategoryReview(categoryFullPath: string | null | undefined) {
  return !categoryFullPath || isCpaReviewCategory(categoryFullPath);
}

/** Category ids whose full_path is a CPA-review path ("Ask My Accountant"). Centralized (OPT-07). */
export async function getCpaReviewCategoryIdSet(supabase: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("categories")
    .select("id")
    .in("full_path", [...CPA_REVIEW_CATEGORY_PATHS]);
  // B4: throw, never coerce a failed query to an empty set — an empty set silently makes every
  // "Ask My Accountant" row stop counting as backlog (wrong counts, no error) across the whole app.
  if (error) throw new Error(`getCpaReviewCategoryIdSet failed: ${error.message}`);
  return new Set((data ?? []).map((row: { id: string }) => row.id));
}

/** Review backlog by category id: null (uncategorized) or a CPA-review id (AMA). Centralized (OPT-07). */
export function needsReviewCategory(
  categoryId: string | null | undefined,
  cpaReviewIds: Set<string>,
): boolean {
  return !categoryId || cpaReviewIds.has(categoryId);
}

/**
 * PostgREST `.or(...)` clause matching review-backlog rows — uncategorized OR a
 * CPA-review category — on the embedded `classification` table. Mirrors the shape
 * getSidebarEntityNav uses so every backlog count agrees (BUG-14/OPT-06).
 */
export function reviewBacklogOrClause(cpaReviewIds: Iterable<string>): string {
  const ids = [...cpaReviewIds];
  const nullClause = "classification.category_id.is.null";
  return ids.length === 0
    ? nullClause
    : `${nullClause},classification.category_id.in.(${ids.join(",")})`;
}
