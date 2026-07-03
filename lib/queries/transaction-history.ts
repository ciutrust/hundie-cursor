import type { SupabaseClient } from "@supabase/supabase-js";
import type { createClient } from "@/lib/supabase/server";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

// Page size for scanning the audit table. Kept modest — this is a distinct-id scan, not a full export.
const PAGE_SIZE = 1000;

/**
 * C8: the set of `transaction_id`s that appear in the `transaction_history` audit trail — i.e. every
 * transaction whose amount/date/description was edited AFTER the fact. Used by the close pages to flag
 * "changed since close" on a month that otherwise reads closed.
 *
 * FAIL-SOFT (non-negotiable): the `transaction_history` table is OPERATOR-applied AFTER this code
 * merges + deploys, so it may not exist yet. On ANY error — the query returning an `error` (esp.
 * relation-does-not-exist / Postgres 42P01) OR a thrown exception — this returns an EMPTY Set and
 * `console.warn`s once. It NEVER throws: the Month-Close / Tax-Close pages must render normally
 * pre-migration. `year` is accepted for a future in-year narrowing; today the trail has no
 * transaction_date column, so we scan all ids (dedup happens in the Set).
 */
export async function fetchChangedTransactionIds(
  supabase: ServerClient,
  // Reserved for future in-year narrowing (the trail has no date column yet); intentionally unused.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  year?: number,
): Promise<Set<string>> {
  // transaction_history is not in the generated DB types (operator-applied later, no CLI to regen),
  // so read it through an untyped client view — same pattern as classification_proposals.
  const db = supabase as unknown as SupabaseClient;
  const ids = new Set<string>();
  try {
    let from = 0;
    // Paginate defensively so a large trail is not silently truncated at the default 1000.
    while (true) {
      const { data, error } = await db
        .from("transaction_history")
        .select("transaction_id")
        .order("transaction_id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (error) {
        // Table missing (pre-migration) or any other read failure → fail soft.
        console.warn(
          `[transaction-history] changed-transaction fetch failed; treating as no changes (pre-migration or read error): ${
            (error as { message?: string }).message ?? String(error)
          }`,
        );
        return new Set<string>();
      }

      const rows = (data ?? []) as Array<{ transaction_id: string }>;
      for (const row of rows) {
        if (row.transaction_id) ids.add(row.transaction_id);
      }
      if (rows.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
  } catch (err) {
    console.warn(
      `[transaction-history] changed-transaction fetch threw; treating as no changes: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return new Set<string>();
  }
  return ids;
}
