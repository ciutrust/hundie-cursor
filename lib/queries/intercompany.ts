import type { PeriodRange } from "@/lib/period";
import { createClient } from "@/lib/supabase/server";
import { paginateAll } from "@/lib/supabase/paginate";
import { flagIntercompanyMatches, type FlaggedLeg } from "@/lib/intercompany";

type IntercompanyTxRow = {
  transaction_date: string;
  amount: number;
  description: string;
  classification: { entity: { slug: string }; category: { full_path: string } | null };
};

/**
 * Categories that mark the 136 Anita intercompany lease (ACCT-07). The lease is booked on BOTH
 * sides under dedicated categories: a GBSL expense leg (kind "expense" — real deductible rent on
 * GBSL's standalone books) and the offsetting Austin ACAA income leg (kind "income"). Surfacing
 * both lets the pair be netted (a consolidation-level elimination, flagged via `potentialMirror`)
 * and confirms the lease is counted once, not double-counted across the two entities.
 *
 * The legacy "→ Austin ACAA (136 Anita)" staging label and "Intercompany — pending" are kept so
 * unresolved / not-yet-migrated legs still surface for triage. The over-broad "Rent Expense"
 * anchor was dropped — it flagged every GBSL rent line, not just the 136 Anita lease (ACCT-10
 * splits the rest into per-location subaccounts).
 */
const INTERCOMPANY_CATEGORY_PATHS = new Set([
  "Intercompany — 136 Anita", // GBSL expense leg (lease paid to ACAA)
  "Intercompany — 136 Anita (income)", // Austin ACAA income leg (rent from GBSL)
  "Intercompany — pending", // unresolved intercompany — triage
  "→ Austin ACAA (136 Anita)", // legacy staging label — triage
]);

export async function getIntercompanyReview(period: PeriodRange): Promise<FlaggedLeg[]> {
  const supabase = await createClient();
  const { start, end } = period;

  // OPT-02: paginate so the intercompany scan isn't silently truncated at 1000 rows.
  const data = await paginateAll<IntercompanyTxRow>(async (from, pageSize) => {
    const { data, error } = await supabase
      .from("transactions")
      .select(
        `
        transaction_date,
        amount,
        description,
        classification:classifications!inner(
          entity:entities!inner(slug),
          category:categories(full_path)
        )
      `,
      )
      .gte("transaction_date", start)
      .lt("transaction_date", end)
      // C4: a Plaid-reversed leg is not a real intercompany transfer — exclude it from the review.
      .is("plaid_removed_at", null)
      .order("transaction_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    return { data: data as IntercompanyTxRow[] | null, error };
  });

  const rows = data
    .filter((row) => {
      const path = row.classification.category?.full_path;
      return path != null && INTERCOMPANY_CATEGORY_PATHS.has(path);
    })
    .map((row) => ({
      entitySlug: row.classification.entity.slug,
      transactionDate: row.transaction_date,
      amount: Number(row.amount),
      categoryPath: row.classification.category!.full_path,
      description: row.description,
    }));

  return flagIntercompanyMatches(rows);
}
