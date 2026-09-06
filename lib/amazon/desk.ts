import { needsCategoryReview } from "@/lib/category-review";
import type { ChargeLinkStatus } from "@/lib/amazon/types";

/** Queue tabs on /amazon. Suggested matches sit in uncategorized or unmatched, not their own tab. */
export type AmazonDeskStatus = "uncategorized" | "unmatched" | "skipped" | "done" | "all";

export type AmazonDeskBucket = "uncategorized" | "unmatched" | "skipped" | "done";

/** Paying an Amazon card from checking is not an Amazon purchase. */
export function isAmazonCardPaymentCategory(fullPath: string | null | undefined): boolean {
  if (!fullPath) return false;
  return /(?:^|:|\s)Credit card payment$/i.test(fullPath.trim());
}

export function amazonDeskBucket(opts: {
  linkStatus: ChargeLinkStatus | null | undefined;
  categoryFullPath: string | null | undefined;
}): AmazonDeskBucket {
  if (opts.linkStatus === "confirmed") return "done";
  if (opts.linkStatus === "rejected") {
    return needsCategoryReview(opts.categoryFullPath) ? "uncategorized" : "skipped";
  }
  if (needsCategoryReview(opts.categoryFullPath)) return "uncategorized";
  return "unmatched";
}

export function parseAmazonDeskStatus(raw: string | undefined): AmazonDeskStatus {
  if (
    raw === "unmatched" ||
    raw === "done" ||
    raw === "all" ||
    raw === "uncategorized" ||
    raw === "skipped"
  ) {
    return raw;
  }
  if (raw === "confirmed") return "done";
  if (raw === "rejected") return "skipped";
  if (raw === "suggested") return "unmatched";
  if (raw === "open") return "uncategorized";
  return "uncategorized";
}
