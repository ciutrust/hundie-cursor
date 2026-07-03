import { createClient } from "@/lib/supabase/server";
import { paginateAll } from "@/lib/supabase/paginate";
import { categoryKind } from "@/lib/category-kind";
import { isBookedOperatingExpense } from "@/lib/category-expense";
import type { PeriodRange } from "@/lib/period";

export type IncomeCategoryRow = { category: string; total: number; count: number };

export type EntityIncome = {
  slug: string;
  name: string;
  /** Operating income (kind = income), summed by magnitude so legacy positive + new negative both count. */
  incomeTotal: number;
  /** Operating expenses (for the net line). */
  expenseTotal: number;
  /** income − expenses (the start of a per-entity P&L). */
  net: number;
  /** Income broken down by source category. */
  byCategory: IncomeCategoryRow[];
};

type IncomeRow = {
  id: string;
  amount: number | string;
  classifications: {
    entity_id: string | null;
    category_id: string | null;
    categories: { full_path: string | null } | null;
  } | null;
};

/** Per-entity money-in: income by source + net (income − expenses) for the period. Expense-first; this is
 *  a secondary lens. Income is identified by category kind, not sign (see docs/INCOME_CAPTURE_PLAN.md). */
export async function getIncomeSummary(period: PeriodRange): Promise<EntityIncome[]> {
  const supabase = await createClient();
  const { start, end } = period;

  const { data: entities, error: entError } = await supabase
    .from("entities")
    .select("id, name, slug, display_order")
    .eq("is_classifiable", true)
    .order("display_order");
  if (entError) throw entError;

  // Stable pagination: order by a UNIQUE column (id) so a >1000-row period never skips/duplicates a
  // row across pages (which would corrupt the summed income/expense totals). `key` makes paginateAll
  // throw loudly if that invariant is ever violated. See lib/supabase/paginate.ts.
  const rows = await paginateAll<IncomeRow>(
    async (from, pageSize) => {
      const { data, error } = await supabase
        .from("transactions")
        .select("id, amount, classifications(entity_id, category_id, categories(full_path))")
        .gte("transaction_date", start)
        .lt("transaction_date", end)
        .order("id")
        .range(from, from + pageSize - 1);
      return { data: data as unknown as IncomeRow[] | null, error };
    },
    1000,
    (r) => r.id,
  );

  return (entities ?? []).map((entity) => {
    const entityRows = rows.filter((r) => r.classifications?.entity_id === entity.id);
    const incomeRows = entityRows.filter(
      (r) => categoryKind(r.classifications?.categories?.full_path) === "income",
    );
    const incomeTotal = incomeRows.reduce((sum, r) => sum + Math.abs(Number(r.amount)), 0);
    // BUG-04/QA-01: shared predicate (AMA + uncategorized excluded) + signed sum so refunds net.
    const expenseTotal = entityRows
      .filter((r) => isBookedOperatingExpense(r.classifications?.categories?.full_path))
      .reduce((sum, r) => sum + Number(r.amount), 0);

    const byCat = new Map<string, IncomeCategoryRow>();
    for (const r of incomeRows) {
      const category = r.classifications?.categories?.full_path ?? "Income";
      const g = byCat.get(category) ?? { category, total: 0, count: 0 };
      g.total += Math.abs(Number(r.amount));
      g.count += 1;
      byCat.set(category, g);
    }

    return {
      slug: entity.slug,
      name: entity.name,
      incomeTotal,
      expenseTotal,
      net: incomeTotal - expenseTotal,
      byCategory: [...byCat.values()].sort((a, b) => b.total - a.total),
    };
  });
}
