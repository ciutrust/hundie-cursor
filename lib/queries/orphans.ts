import type { createClient } from "@/lib/supabase/server";
import { paginateAll } from "@/lib/supabase/paginate";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/** Minimal shape needed to bucket an orphan: which account + when. */
export type OrphanRow = { id: string; account_id: string; transaction_date: string };

/** Bucket key for orphans on an account with no default entity — surfaced, never dropped. */
export const UNASSIGNED_ENTITY_KEY = "unassigned";

function monthFromDate(date: string): number {
  return Number(date.slice(5, 7));
}

/**
 * C9 (pure, unit-tested): bucket orphan rows into `entityId -> { month -> count }`, keyed by the
 * account's `default_entity_id`. An orphan whose account is missing OR has a null default entity
 * buckets to `"unassigned"` — it must NEVER be silently dropped (that would let its month read
 * closed with unbooked charges).
 */
export function bucketOrphansByEntityMonth(
  orphans: OrphanRow[],
  accountsById: Map<string, { default_entity_id: string | null }>,
): Map<string, Record<number, number>> {
  const out = new Map<string, Record<number, number>>();
  for (const orphan of orphans) {
    const account = accountsById.get(orphan.account_id);
    const entityKey = account?.default_entity_id ?? UNASSIGNED_ENTITY_KEY;
    const month = monthFromDate(orphan.transaction_date);
    const byMonth = out.get(entityKey) ?? {};
    byMonth[month] = (byMonth[month] ?? 0) + 1;
    out.set(entityKey, byMonth);
  }
  return out;
}

/**
 * C9: orphan counts per entity+month for the given year, computed by DIFF (flat, fake-testable) so
 * we never touch the report `!inner` semantics:
 *   1. all in-year, non-removed transactions (flat);
 *   2. the subset that has a classifications row (chunked `.in("transaction_id", ...)`);
 *   3. orphans = the transactions whose id is NOT in that set;
 *   4. bucket by the account's default entity (`"unassigned"` fallback) and month.
 * Removed rows are excluded — a Plaid-reversed charge is not an orphan to book (C4).
 */
export async function fetchOrphanCountsByEntityMonth(
  supabase: ServerClient,
  year: number,
): Promise<Map<string, Record<number, number>>> {
  const start = `${year}-01-01`;
  const end = `${year + 1}-01-01`;

  const yearTxns = await paginateAll<OrphanRow & { plaid_removed_at: string | null }>(
    async (from, pageSize) => {
      const { data, error } = await supabase
        .from("transactions")
        .select("id, account_id, transaction_date, plaid_removed_at")
        .gte("transaction_date", start)
        .lt("transaction_date", end)
        .is("plaid_removed_at", null)
        .order("id")
        .range(from, from + pageSize - 1);
      return { data: data as (OrphanRow & { plaid_removed_at: string | null })[] | null, error };
    },
    1000,
    (row) => row.id,
  );

  if (yearTxns.length === 0) return new Map();

  // Which of those transactions actually have a classification? Chunk to keep the `.in()` list small.
  const classifiedIds = new Set<string>();
  const yearTxnIds = yearTxns.map((t) => t.id);
  for (let i = 0; i < yearTxnIds.length; i += 200) {
    const chunk = yearTxnIds.slice(i, i + 200);
    const { data, error } = await supabase
      .from("classifications")
      .select("transaction_id")
      .in("transaction_id", chunk);
    if (error) throw error;
    for (const row of data ?? []) classifiedIds.add(row.transaction_id as string);
  }

  const orphans = yearTxns.filter((t) => !classifiedIds.has(t.id));
  if (orphans.length === 0) return new Map();

  // Accounts map for entity bucketing.
  const accountIds = [...new Set(orphans.map((o) => o.account_id))];
  const accountsById = new Map<string, { default_entity_id: string | null }>();
  for (let i = 0; i < accountIds.length; i += 200) {
    const chunk = accountIds.slice(i, i + 200);
    const { data, error } = await supabase
      .from("accounts")
      .select("id, default_entity_id")
      .in("id", chunk);
    if (error) throw error;
    for (const row of data ?? []) {
      accountsById.set(row.id as string, { default_entity_id: (row.default_entity_id as string | null) ?? null });
    }
  }

  return bucketOrphansByEntityMonth(orphans, accountsById);
}
