import type { PeriodRange } from "@/lib/period";
import { isOperatingExpense } from "@/lib/category-expense";
import { CPA_REVIEW_CATEGORY_PATHS } from "@/lib/category-review";
import { createClient } from "@/lib/supabase/server";
import { paginateAll } from "@/lib/supabase/paginate";

export type EntityHomeStats = {
  slug: string;
  name: string;
  expenseTotal: number;
  transactionCount: number;
  unclassifiedCount: number;
  unclassifiedTotal: number;
  topCategory: { name: string; total: number } | null;
};

async function getCpaReviewCategoryIdSet(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data } = await supabase
    .from("categories")
    .select("id, full_path")
    .in("full_path", [...CPA_REVIEW_CATEGORY_PATHS]);
  return new Set((data ?? []).map((row) => row.id));
}

function needsReviewCategory(categoryId: string | null, cpaReviewIds: Set<string>) {
  return categoryId == null || cpaReviewIds.has(categoryId);
}

async function fetchEntityPeriodTransactions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  start: string,
  end: string,
  entityId: string,
) {
  return paginateAll(async (from, pageSize) => {
    const { data, error } = await supabase
      .from("transactions")
      .select(
        `
        amount,
        classification:classifications!inner(
          entity_id,
          category_id,
          category:categories(full_path)
        )
      `,
      )
      .eq("classification.entity_id", entityId)
      .gte("transaction_date", start)
      .lt("transaction_date", end)
      .order("transaction_date")
      .order("id")
      .range(from, from + pageSize - 1);
    return { data, error };
  });
}

function buildStatsFromTransactions(
  slug: string,
  name: string,
  transactions: Array<{
    amount: number;
    classification: {
      category_id: string | null;
      category?: { full_path: string } | null;
    };
  }>,
  cpaReviewIds: Set<string>,
): EntityHomeStats {
  let expenseTotal = 0;
  let unclassifiedCount = 0;
  let unclassifiedTotal = 0;
  const categoryTotals = new Map<string, number>();

  for (const tx of transactions) {
    const categoryPath = tx.classification.category?.full_path ?? null;
    const isReview = needsReviewCategory(tx.classification.category_id, cpaReviewIds);

    if (isReview) {
      unclassifiedCount += 1;
      if (Number(tx.amount) > 0) unclassifiedTotal += Number(tx.amount);
      continue;
    }

    if (isOperatingExpense(tx.amount, categoryPath)) {
      expenseTotal += Number(tx.amount);
      if (categoryPath) {
        categoryTotals.set(categoryPath, (categoryTotals.get(categoryPath) ?? 0) + Number(tx.amount));
      }
    }
  }

  let topCategory: { name: string; total: number } | null = null;
  for (const [name, total] of categoryTotals.entries()) {
    if (!topCategory || total > topCategory.total) {
      topCategory = { name, total };
    }
  }

  return {
    slug,
    name,
    expenseTotal,
    transactionCount: transactions.length,
    unclassifiedCount,
    unclassifiedTotal,
    topCategory,
  };
}

export async function getEntityHomeStats(
  entitySlug: string,
  period: PeriodRange,
): Promise<EntityHomeStats | null> {
  const supabase = await createClient();
  const { data: entity, error } = await supabase
    .from("entities")
    .select("id, name, slug")
    .eq("slug", entitySlug)
    .eq("is_classifiable", true)
    .single();

  if (error || !entity) return null;

  const cpaReviewIds = await getCpaReviewCategoryIdSet(supabase);
  const transactions = await fetchEntityPeriodTransactions(
    supabase,
    period.start,
    period.end,
    entity.id,
  );

  return buildStatsFromTransactions(entity.slug, entity.name, transactions, cpaReviewIds);
}

export async function getAllEntityHomeStats(period: PeriodRange): Promise<EntityHomeStats[]> {
  const supabase = await createClient();
  const { data: entities, error } = await supabase
    .from("entities")
    .select("id, name, slug")
    .eq("is_classifiable", true)
    .order("display_order");

  if (error) throw error;

  const cpaReviewIds = await getCpaReviewCategoryIdSet(supabase);

  const stats = await Promise.all(
    (entities ?? []).map(async (entity) => {
      const transactions = await fetchEntityPeriodTransactions(
        supabase,
        period.start,
        period.end,
        entity.id,
      );
      return buildStatsFromTransactions(entity.slug, entity.name, transactions, cpaReviewIds);
    }),
  );

  return stats.sort(
    (a, b) => b.unclassifiedCount - a.unclassifiedCount || b.expenseTotal - a.expenseTotal,
  );
}
