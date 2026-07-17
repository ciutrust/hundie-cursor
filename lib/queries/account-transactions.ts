import {
  fetchPeriodTransactionDetails,
  hydrateTransactionSplits,
} from "@/lib/queries/review";
import { createClient } from "@/lib/supabase/server";
import type { TransactionWithDetails } from "@/lib/types/database";

/**
 * Every row past this ships to the browser as serialized props AND lives in the client selection
 * state, so an "all accounts, all time" window has to stop somewhere. Trip windows - the page's
 * actual job - are hundreds of rows at most.
 */
export const TRANSACTIONS_BROWSER_CAP = 2000;

/**
 * Every transaction on the given accounts within [start, end) — across ALL entities, newest first.
 *
 * This is the /transactions browser's read: "these cards, this window, whatever entity they landed in".
 * The review query is entity-scoped; this one deliberately passes NO entity filter, so a charge shows
 * up regardless of which entity it was booked to (or whether it's categorized at all). Split parents
 * come back hydrated as editable "Split" rows, same as the review list.
 *
 * `capped` means rows past TRANSACTIONS_BROWSER_CAP were cut off - the page MUST say so, because its
 * running total and CSV cover only the rows returned.
 */
export async function getAccountTransactions(options: {
  start: string;
  /** EXCLUSIVE (see lib/date-range.ts). */
  end: string;
  accountIds: string[];
}): Promise<{ transactions: TransactionWithDetails[]; capped: boolean }> {
  // No accounts checked = show nothing. Guard first: an empty `.in()` would otherwise be a no-op
  // filter and dump the entire ledger for the window.
  if (options.accountIds.length === 0) return { transactions: [], capped: false };

  const supabase = await createClient();
  // Fetch one row past the cap purely to learn whether anything was cut off.
  const fetched = await fetchPeriodTransactionDetails(supabase, options.start, options.end, {
    accountIds: options.accountIds,
    maxRows: TRANSACTIONS_BROWSER_CAP + 1,
  });
  const capped = fetched.length > TRANSACTIONS_BROWSER_CAP;
  const transactions = capped ? fetched.slice(0, TRANSACTIONS_BROWSER_CAP) : fetched;
  await hydrateTransactionSplits(supabase, transactions);
  return { transactions, capped };
}
