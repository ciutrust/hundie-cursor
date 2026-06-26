/** Categories QB/CPA assigned that still need Alex review in Hundie. */
export const CPA_REVIEW_CATEGORY_PATHS = new Set(["Ask My Accountant"]);

export function isCpaReviewCategory(fullPath: string | null | undefined) {
  return fullPath != null && CPA_REVIEW_CATEGORY_PATHS.has(fullPath);
}

export function needsCategoryReview(categoryFullPath: string | null | undefined) {
  return !categoryFullPath || isCpaReviewCategory(categoryFullPath);
}
