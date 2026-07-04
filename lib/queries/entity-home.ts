import type { PeriodRange } from "@/lib/period";
import { isBookedOperatingExpense } from "@/lib/category-expense";
import { getCpaReviewCategoryIdSet, needsReviewCategory } from "@/lib/category-review";
import { createClient } from "@/lib/supabase/server";
import { pgError } from "@/lib/supabase/errors";
import { fetchPeriodTransactions } from "@/lib/queries/fetch-period-transactions";

export type EntityHomeStats = {
  slug: string;
  name: string;
  expenseTotal: number;
  transactionCount: number;
  unclassifiedCount: number;
  unclassifiedTotal: number;
  topCategory: { name: string; total: number } | null;
};

const ENTITY_HOME_SELECT = `
  amount,
  classification:classifications!inner(
    entity_id,
    category_id,
    category:categories(full_path)
  )
`;

type EntityHomeTxn = {
  amount: number;
  classification: {
    entity_id: string;
    category_id: string | null;
    category?: { full_path: string } | null;
  };
};

function fetchEntityPeriodTransactions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  start: string,
  end: string,
  entityId?: string,
): Promise<EntityHomeTxn[]> {
  // OPT-08: same select/filters/ascending order; entityId now optional so the
  // dashboard/sidebar can fetch the whole period once and group in JS (OPT-04).
  return fetchPeriodTransactions<EntityHomeTxn>({
    supabase,
    select: ENTITY_HOME_SELECT,
    start,
    end,
    entityId,
    order: "asc",
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

    if (isBookedOperatingExpense(categoryPath)) {
      // BUG-04: signed sum so a refund in an expense category nets its charge.
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

  // E1: throw a structured Error (not the raw PostgREST object, whose .message is often '' → the
  // ×463 unrecoverable "{ message: '' }" sidebar logs). Original error preserved as `cause`.
  if (error) throw pgError("entity-home entities", error);

  const cpaReviewIds = await getCpaReviewCategoryIdSet(supabase);

  // OPT-04: fetch the whole period ONCE (no entity filter) and group by entity in JS,
  // instead of running one ordered scan per entity. The global (transaction_date, id)
  // ordering preserves each entity's relative row order, so per-entity sums and the
  // topCategory tie-break are identical.
  const transactions = await fetchEntityPeriodTransactions(supabase, period.start, period.end);
  const byEntity = new Map<string, EntityHomeTxn[]>();
  for (const tx of transactions) {
    const eid = tx.classification.entity_id;
    const bucket = byEntity.get(eid);
    if (bucket) bucket.push(tx);
    else byEntity.set(eid, [tx]);
  }

  const stats = (entities ?? []).map((entity) =>
    buildStatsFromTransactions(
      entity.slug,
      entity.name,
      byEntity.get(entity.id) ?? [],
      cpaReviewIds,
    ),
  );

  return stats.sort(
    (a, b) => b.unclassifiedCount - a.unclassifiedCount || b.expenseTotal - a.expenseTotal,
  );
}

export type SidebarEntityNavItem = {
  slug: string;
  name: string;
  unclassifiedCount: number;
};

/** Lightweight entity list + review-backlog counts for the sidebar (no full transaction scan). */
export async function getSidebarEntityNav(period: PeriodRange): Promise<SidebarEntityNavItem[]> {
  const supabase = await createClient();
  const { data: entities, error } = await supabase
    .from("entities")
    .select("id, name, slug")
    .eq("is_classifiable", true)
    .order("display_order");

  // E1: throw a structured Error (not the raw PostgREST object, whose .message is often '' → the
  // ×463 unrecoverable "{ message: '' }" sidebar logs). Original error preserved as `cause`.
  if (error) throw pgError("entity-home entities", error);

  const cpaReviewIds = await getCpaReviewCategoryIdSet(supabase);

  // OPT-04: one period fetch + JS count instead of N per-entity count queries. The JS
  // predicate needsReviewCategory(category_id) (null OR a CPA-review id) is exactly the
  // reviewBacklogOrClause the count queries used, over the same !inner-joined rows.
  const transactions = await fetchEntityPeriodTransactions(supabase, period.start, period.end);
  const backlogByEntity = new Map<string, number>();
  for (const tx of transactions) {
    if (needsReviewCategory(tx.classification.category_id, cpaReviewIds)) {
      const eid = tx.classification.entity_id;
      backlogByEntity.set(eid, (backlogByEntity.get(eid) ?? 0) + 1);
    }
  }

  const counts = (entities ?? []).map((entity) => ({
    slug: entity.slug,
    name: entity.name,
    unclassifiedCount: backlogByEntity.get(entity.id) ?? 0,
  }));

  return counts.sort((a, b) => b.unclassifiedCount - a.unclassifiedCount);
}
