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
 * Categories that mark an intercompany leg. The GBSL→Austin ACAA (136 Anita) lease
 * is booked as a GBSL "Rent Expense"; the offsetting/mirror side is tagged with the
 * redirect or staging categories. Surfacing all of these together lets a human
 * confirm the lease is counted once and not double-counted across entities.
 */
const INTERCOMPANY_CATEGORY_PATHS = new Set([
  "Intercompany — pending",
  "→ Austin ACAA (136 Anita)",
  "Rent Expense",
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
