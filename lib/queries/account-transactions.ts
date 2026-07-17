import {
  fetchPeriodTransactionDetails,
  hydrateTransactionSplits,
} from "@/lib/queries/review";
import { createClient } from "@/lib/supabase/server";
import type { TransactionWithDetails } from "@/lib/types/database";

/**
 * Every transaction on the given accounts within [start, end) — across ALL entities, newest first.
 *
 * This is the /transactions browser's read: "these cards, this window, whatever entity they landed in".
 * The review query is entity-scoped; this one deliberately passes NO entity filter, so a charge shows
 * up regardless of which entity it was booked to (or whether it's categorized at all). Split parents
 * come back hydrated as editable "Split" rows, same as the review list.
 */
export async function getAccountTransactions(options: {
  start: string;
  /** EXCLUSIVE (see lib/date-range.ts). */
  end: string;
  accountIds: string[];
}): Promise<TransactionWithDetails[]> {
  // No accounts checked = show nothing. Guard first: an empty `.in()` would otherwise be a no-op
  // filter and dump the entire ledger for the window.
  if (options.accountIds.length === 0) return [];

  const supabase = await createClient();
  const transactions = await fetchPeriodTransactionDetails(supabase, options.start, options.end, {
    accountIds: options.accountIds,
  });
  await hydrateTransactionSplits(supabase, transactions);
  return transactions;
}
