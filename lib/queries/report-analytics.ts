import type { PeriodRange } from "@/lib/period";
import { isOperatingExpense } from "@/lib/category-expense";
import { CPA_REVIEW_CATEGORY_PATHS } from "@/lib/category-review";
import { extractVendorSearchKey } from "@/lib/suggestions/category-suggestions";
import { createClient } from "@/lib/supabase/server";
import { paginateAll } from "@/lib/supabase/paginate";

type TxRow = {
  id: string;
  amount: number;
  transaction_date: string;
  description: string;
  vendor: string | null;
  classification: {
    entity_id: string;
    category_id: string | null;
    entity: { slug: string; name: string };
    category: { full_path: string } | null;
  };
  account: { slug: string; display_name: string };
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

async function fetchPeriodTransactions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  start: string,
  end: string,
  entitySlug?: string,
) {
  return paginateAll(async (from, pageSize) => {
    let query = supabase
      .from("transactions")
      .select(
        `
        id,
        amount,
        transaction_date,
        description,
        vendor,
        account:accounts!inner(slug, display_name),
        classification:classifications!inner(
          entity_id,
          category_id,
          entity:entities!inner(slug, name),
          category:categories(full_path)
        )
      `,
      )
      .gte("transaction_date", start)
      .lt("transaction_date", end)
      .order("transaction_date")
      .order("id")
      .range(from, from + pageSize - 1);

    if (entitySlug) {
      query = query.eq("classification.entity.slug", entitySlug);
    }

    const { data, error } = await query;
    return { data: data as TxRow[] | null, error };
  });
}

export type TopVendorRow = {
  vendorKey: string;
  label: string;
  count: number;
  total: number;
  entitySlug: string;
};

export async function getTopVendors(
  period: PeriodRange,
  entitySlug?: string,
  limit = 25,
): Promise<TopVendorRow[]> {
  const supabase = await createClient();
  const transactions = await fetchPeriodTransactions(
    supabase,
    period.start,
    period.end,
    entitySlug,
  );

  const buckets = new Map<string, TopVendorRow>();

  for (const tx of transactions) {
    if (!isOperatingExpense(tx.amount, tx.classification.category?.full_path ?? null)) continue;
    if (Number(tx.amount) <= 0) continue;

    const vendorKey = extractVendorSearchKey(tx.description, tx.vendor) || "(unknown)";
    const key = `${tx.classification.entity.slug}|${vendorKey}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.count += 1;
      existing.total += Number(tx.amount);
    } else {
      buckets.set(key, {
        vendorKey,
        label: vendorKey,
        count: 1,
        total: Number(tx.amount),
        entitySlug: tx.classification.entity.slug,
      });
    }
  }

  return [...buckets.values()].sort((a, b) => b.total - a.total).slice(0, limit);
}

export type UncategorizedAgingRow = {
  id: string;
  transaction_date: string;
  description: string;
  amount: number;
  entitySlug: string;
  entityName: string;
  accountName: string;
  daysOld: number;
};

export async function getUncategorizedAging(
  period: PeriodRange,
  entitySlug?: string,
): Promise<UncategorizedAgingRow[]> {
  const supabase = await createClient();
  const cpaReviewIds = await getCpaReviewCategoryIdSet(supabase);
  const transactions = await fetchPeriodTransactions(
    supabase,
    period.start,
    period.end,
    entitySlug,
  );
  const today = new Date();

  return transactions
    .filter((tx) => needsReviewCategory(tx.classification.category_id, cpaReviewIds))
    .map((tx) => {
      const txDate = new Date(tx.transaction_date + "T12:00:00");
      const daysOld = Math.floor((today.getTime() - txDate.getTime()) / (1000 * 60 * 60 * 24));
      return {
        id: tx.id,
        transaction_date: tx.transaction_date,
        description: tx.description,
        amount: Number(tx.amount),
        entitySlug: tx.classification.entity.slug,
        entityName: tx.classification.entity.name,
        accountName: tx.account.display_name,
        daysOld,
      };
    })
    .sort((a, b) => b.daysOld - a.daysOld || b.amount - a.amount);
}

export type ClassificationProgressRow = {
  entitySlug: string;
  entityName: string;
  totalCount: number;
  classifiedCount: number;
  unclassifiedCount: number;
  classifiedPct: number;
};

export async function getClassificationProgress(
  period: PeriodRange,
): Promise<ClassificationProgressRow[]> {
  const supabase = await createClient();
  const cpaReviewIds = await getCpaReviewCategoryIdSet(supabase);
  const transactions = await fetchPeriodTransactions(supabase, period.start, period.end);
  const byEntity = new Map<string, ClassificationProgressRow>();

  for (const tx of transactions) {
    const slug = tx.classification.entity.slug;
    const row = byEntity.get(slug) ?? {
      entitySlug: slug,
      entityName: tx.classification.entity.name,
      totalCount: 0,
      classifiedCount: 0,
      unclassifiedCount: 0,
      classifiedPct: 0,
    };
    row.totalCount += 1;
    if (needsReviewCategory(tx.classification.category_id, cpaReviewIds)) {
      row.unclassifiedCount += 1;
    } else {
      row.classifiedCount += 1;
    }
    byEntity.set(slug, row);
  }

  return [...byEntity.values()]
    .map((row) => ({
      ...row,
      classifiedPct: row.totalCount > 0 ? row.classifiedCount / row.totalCount : 1,
    }))
    .sort((a, b) => a.classifiedPct - b.classifiedPct);
}

export type AccountSummaryRow = {
  accountSlug: string;
  accountName: string;
  entitySlug: string;
  count: number;
  total: number;
};

export async function getAccountSummary(
  period: PeriodRange,
  entitySlug?: string,
): Promise<AccountSummaryRow[]> {
  const supabase = await createClient();
  const transactions = await fetchPeriodTransactions(
    supabase,
    period.start,
    period.end,
    entitySlug,
  );
  const buckets = new Map<string, AccountSummaryRow>();

  for (const tx of transactions) {
    if (!isOperatingExpense(tx.amount, tx.classification.category?.full_path ?? null)) continue;
    const key = `${tx.classification.entity.slug}|${tx.account.slug}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.count += 1;
      existing.total += Number(tx.amount);
    } else {
      buckets.set(key, {
        accountSlug: tx.account.slug,
        accountName: tx.account.display_name,
        entitySlug: tx.classification.entity.slug,
        count: 1,
        total: Number(tx.amount),
      });
    }
  }

  return [...buckets.values()].sort((a, b) => b.total - a.total);
}

export type YoyComparisonRow = {
  entitySlug: string;
  entityName: string;
  currentTotal: number;
  priorTotal: number;
  changePct: number | null;
};

export async function getYoyEntityComparison(period: PeriodRange): Promise<YoyComparisonRow[]> {
  const supabase = await createClient();
  const priorStart = period.compareStart;
  const priorEnd = period.compareEnd;

  const [current, prior] = await Promise.all([
    fetchPeriodTransactions(supabase, period.start, period.end),
    fetchPeriodTransactions(supabase, priorStart, priorEnd),
  ]);

  const sumByEntity = (rows: TxRow[]) => {
    const map = new Map<string, { name: string; total: number }>();
    for (const tx of rows) {
      if (!isOperatingExpense(tx.amount, tx.classification.category?.full_path ?? null)) continue;
      const slug = tx.classification.entity.slug;
      const entry = map.get(slug) ?? { name: tx.classification.entity.name, total: 0 };
      entry.total += Number(tx.amount);
      map.set(slug, entry);
    }
    return map;
  };

  const currentMap = sumByEntity(current);
  const priorMap = sumByEntity(prior);
  const slugs = new Set([...currentMap.keys(), ...priorMap.keys()]);

  return [...slugs].map((slug) => {
    const cur = currentMap.get(slug)?.total ?? 0;
    const prev = priorMap.get(slug)?.total ?? 0;
    return {
      entitySlug: slug,
      entityName: currentMap.get(slug)?.name ?? priorMap.get(slug)?.name ?? slug,
      currentTotal: cur,
      priorTotal: prev,
      changePct: prev !== 0 ? (cur - prev) / prev : null,
    };
  });
}
