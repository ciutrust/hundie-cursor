import type { PeriodRange } from "@/lib/period";
import { isBookedOperatingExpense } from "@/lib/category-expense";
import { getCpaReviewCategoryIdSet, needsReviewCategory } from "@/lib/category-review";
import { createClient } from "@/lib/supabase/server";
import { pgError } from "@/lib/supabase/errors";
import { fetchLedgerExpenseLines } from "@/lib/queries/ledger-expense-lines";

export type EntityHomeStats = {
  slug: string;
  name: string;
  expenseTotal: number;
  transactionCount: number;
  unclassifiedCount: number;
  unclassifiedTotal: number;
  topCategory: { name: string; total: number } | null;
};

type EntityHomeTxn = {
  amount: number;
  classification: {
    entity_id: string;
    category_id: string | null;
    category?: { full_path: string } | null;
  };
};

async function fetchEntityPeriodTransactions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  start: string,
  end: string,
  entityId?: string,
): Promise<EntityHomeTxn[]> {
  // Splits: source expense lines (split parents replaced by their legs, keyed on each leg's entity),
  // then group by entity in JS. entityId optional so the dashboard/sidebar fetch the whole period once.
  const lines = await fetchLedgerExpenseLines({ supabase, start, end, entityId });
  return lines.map((line) => ({
    amount: line.amount,
    classification: {
      entity_id: line.classification.entity_id,
      category_id: line.classification.category_id,
      category: line.classification.category
        ? { full_path: line.classification.category.full_path }
        : null,
    },
  }));
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

/**
 * Lightweight entity list + review-backlog counts for the sidebar (no full transaction scan).
 *
 * `injectedClient` lets a session-less caller (the weekly-digest cron, #1) pass a service-role client
 * so the counts run without a user session; UI callers omit it and get the request-scoped client.
 */
export async function getSidebarEntityNav(
  period: PeriodRange,
  injectedClient?: Awaited<ReturnType<typeof createClient>>,
): Promise<SidebarEntityNavItem[]> {
  const supabase = injectedClient ?? (await createClient());
  const { data: entities, error } = await supabase
    .from("entities")
    .select("id, name, slug")
    .eq("is_classifiable", true)
    .order("display_order");

  // E1: throw a structured Error (not the raw PostgREST object, whose .message is often '' → the
  // ×463 unrecoverable "{ message: '' }" sidebar logs). Original error preserved as `cause`.
  if (error) throw pgError("entity-home entities", error);

  const cpaReviewIds = [...(await getCpaReviewCategoryIdSet(supabase))];

  // C1: per-entity HEAD counts instead of scanning the entire YTD ledger on every sidebar render.
  // Backlog = rows with a null category OR a CPA-review ("Ask My Accountant") category, per entity,
  // in-period, excluding Plaid-reversed rows. Two indexed counts (null + AMA) mirror the exact,
  // production-proven top-level embedded-filter shape of countPersonalUncategorizedBacklog — the fake
  // harness can't exercise embedded `.is/.in` filters, so this is smoke-verified, not unit-tested.
  const counts = await Promise.all(
    (entities ?? []).map(async (entity) => {
      const base = () =>
        supabase
          .from("transactions")
          .select("id, classification:classifications!inner(entity_id, category_id)", {
            count: "exact",
            head: true,
          })
          .eq("classification.entity_id", entity.id)
          .is("plaid_removed_at", null)
          // Splits: a split parent is resolved (legs all categorized) — not backlog.
          .is("split_at", null)
          .gte("transaction_date", period.start)
          .lt("transaction_date", period.end);

      const nullRes = await base().is("classification.category_id", null);
      let unclassifiedCount = nullRes.count ?? 0;
      if (cpaReviewIds.length > 0) {
        const amaRes = await base().in("classification.category_id", cpaReviewIds);
        unclassifiedCount += amaRes.count ?? 0;
      }
      return { slug: entity.slug, name: entity.name, unclassifiedCount };
    }),
  );

  return counts.sort((a, b) => b.unclassifiedCount - a.unclassifiedCount);
}
