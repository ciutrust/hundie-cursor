import { createClient } from "@/lib/supabase/server";
import { categoryKind } from "@/lib/category-kind";
import { isBookedOperatingExpense } from "@/lib/category-expense";
import { fetchLedgerExpenseLines } from "@/lib/queries/ledger-expense-lines";
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

  // Splits: a leg can be income/expense in a different entity than the parent — source lines with
  // splits applied (parent replaced by legs, keyed on each leg's own entity), then group in JS.
  const lines = await fetchLedgerExpenseLines({ supabase, start, end });

  return (entities ?? []).map((entity) => {
    const entityRows = lines.filter((l) => l.classification.entity_id === entity.id);
    const incomeRows = entityRows.filter(
      (l) => categoryKind(l.classification.category?.full_path) === "income",
    );
    const incomeTotal = incomeRows.reduce((sum, l) => sum + Math.abs(l.amount), 0);
    // BUG-04/QA-01: shared predicate (AMA + uncategorized excluded) + signed sum so refunds net.
    const expenseTotal = entityRows
      .filter((l) => isBookedOperatingExpense(l.classification.category?.full_path))
      .reduce((sum, l) => sum + l.amount, 0);

    const byCat = new Map<string, IncomeCategoryRow>();
    for (const l of incomeRows) {
      const category = l.classification.category?.full_path ?? "Income";
      const g = byCat.get(category) ?? { category, total: 0, count: 0 };
      g.total += Math.abs(l.amount);
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
