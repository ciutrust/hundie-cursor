/**
 * Pure pagination helper for Plaid's /transactions/sync, isolated from the SDK so it can be
 * unit-tested with a fake page-fetcher. (Ported verbatim from the multi-tenant Hundie build.)
 *
 * Plaid throws TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION when the underlying transaction data
 * changes mid-pagination (common during the initial pull of a large, multi-account item). Their
 * required remediation is to restart the WHOLE loop from the ORIGINAL cursor — not retry the single
 * failed page. We also raise `count` to 500 at the call site to reduce page count.
 */

export const MUTATION_DURING_PAGINATION = "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION";

export interface SyncPage<T> {
  added: T[];
  modified: T[];
  removed: string[]; // external ids of removed transactions
  hasMore: boolean;
  nextCursor: string;
}

export type SyncPageFetcher<T> = (cursor: string | undefined) => Promise<SyncPage<T>>;

export interface CollectedSync<T> {
  added: T[];
  modified: T[];
  removed: string[];
  cursor: string | undefined;
}

/** True if the error is Plaid's "data changed mid-pagination" error. */
export function isMutationDuringPagination(e: unknown): boolean {
  const code =
    (e as { response?: { data?: { error_code?: string } } })?.response?.data?.error_code ??
    (e as { error_code?: string })?.error_code;
  return code === MUTATION_DURING_PAGINATION;
}

export interface CollectOptions {
  /** Max times to restart the loop on a mutation error before giving up. */
  maxRestarts?: number;
  /** Hook between restarts (e.g. a short delay to let the initial pull settle). */
  onRestart?: (attempt: number) => Promise<void> | void;
}

/**
 * Walk every /sync page from `startCursor`, accumulating added/modified/removed. On a
 * mutation-during-pagination error, discard the partial pages and restart the entire loop from
 * `startCursor` (up to `maxRestarts`). Returns the collected changes plus the final cursor.
 */
export async function collectSync<T>(
  fetchPage: SyncPageFetcher<T>,
  startCursor: string | undefined,
  opts: CollectOptions = {},
): Promise<CollectedSync<T>> {
  const maxRestarts = opts.maxRestarts ?? 6;

  for (let attempt = 0; ; attempt++) {
    try {
      const added: T[] = [];
      const modified: T[] = [];
      const removed: string[] = [];
      let cursor = startCursor;
      let hasMore = true;
      while (hasMore) {
        const page = await fetchPage(cursor);
        added.push(...page.added);
        modified.push(...page.modified);
        removed.push(...page.removed);
        hasMore = page.hasMore;
        cursor = page.nextCursor;
      }
      return { added, modified, removed, cursor };
    } catch (e) {
      if (isMutationDuringPagination(e) && attempt < maxRestarts) {
        if (opts.onRestart) await opts.onRestart(attempt + 1);
        continue; // restart the WHOLE loop from startCursor
      }
      throw e;
    }
  }
}
