import type { PeriodRange } from "@/lib/period";
import { CPA_REVIEW_CATEGORY_PATHS, isCpaReviewCategory } from "@/lib/category-review";
import { createClient } from "@/lib/supabase/server";
import type { CategoryGroup, EntitySummary, MonthlyCategoryRow, MonthlyEntityRow, TransactionWithDetails } from "@/lib/types/database";
const TRANSACTION_SELECT = `
  id,
  account_id,
  transaction_date,
  posted_date,
  amount,
  description,
  vendor,
  raw_category,
  import_hash,
  created_at,
  account:accounts!inner(id, display_name, slug, account_type),
  classification:classifications!inner(
    id,
    entity_id,
    category_id,
    classified_at,
    classified_by,
    notes,
    transaction_id,
    entity:entities!inner(id, name, slug),
    category:categories(id, full_path)
  )
`;

async function getCpaReviewCategoryIdSet(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data } = await supabase.from("categories").select("id").in("full_path", [...CPA_REVIEW_CATEGORY_PATHS]);
  return new Set((data ?? []).map((row) => row.id));
}

function needsReviewCategory(categoryId: string | null | undefined, cpaReviewIds: Set<string>) {
  return !categoryId || cpaReviewIds.has(categoryId);
}

export async function getClassifiableEntities() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("entities")
    .select("id, name, slug, display_order")
    .eq("is_classifiable", true)
    .order("display_order");

  if (error) throw error;
  return data ?? [];
}

export async function getEntitySummaries(period: PeriodRange): Promise<EntitySummary[]> {
  const supabase = await createClient();
  const { start, end, compareStart, compareEnd } = period;
  const cpaReviewIds = await getCpaReviewCategoryIdSet(supabase);

  const [entitiesResult, transactionsResult, previousTransactionsResult] = await Promise.all([
    supabase.from("entities").select("id, name, slug, display_order").eq("is_classifiable", true).order("display_order"),
    supabase
      .from("transactions")
      .select(
        `
        id,
        amount,
        classification:classifications!inner(
          entity_id,
          category_id
        )
      `,
      )
      .gte("transaction_date", start)
      .lt("transaction_date", end),
    supabase
      .from("transactions")
      .select(
        `
        id,
        amount,
        classification:classifications!inner(
          entity_id,
          category_id
        )
      `,
      )
      .gte("transaction_date", compareStart)
      .lt("transaction_date", compareEnd),
  ]);

  if (entitiesResult.error) throw entitiesResult.error;
  if (transactionsResult.error) throw transactionsResult.error;
  if (previousTransactionsResult.error) throw previousTransactionsResult.error;

  const entities = entitiesResult.data ?? [];
  const transactions = transactionsResult.data ?? [];
  const previousTransactions = previousTransactionsResult.data ?? [];

  const summaries = entities.map((entity) => {
    const entityTransactions = transactions.filter(
      (tx) => tx.classification.entity_id === entity.id,
    );
    const previousEntityTransactions = previousTransactions.filter(
      (tx) => tx.classification.entity_id === entity.id,
    );
    const expenseTotal = entityTransactions
      .filter((tx) => Number(tx.amount) > 0)
      .reduce((sum, tx) => sum + Number(tx.amount), 0);
    const previousExpenseTotal = previousEntityTransactions
      .filter((tx) => Number(tx.amount) > 0)
      .reduce((sum, tx) => sum + Number(tx.amount), 0);

    return {
      slug: entity.slug,
      name: entity.name,
      total: expenseTotal,
      previousMonthTotal: previousEntityTransactions.length > 0 ? previousExpenseTotal : 0,
      transactionCount: entityTransactions.length,
      unclassifiedCount: entityTransactions.filter((tx) =>
        needsReviewCategory(tx.classification.category_id, cpaReviewIds),
      ).length,
    };
  });

  const reviewTransactions = transactions.filter((tx) =>
    needsReviewCategory(tx.classification.category_id, cpaReviewIds),
  );
  const previousReviewTransactions = previousTransactions.filter((tx) =>
    needsReviewCategory(tx.classification.category_id, cpaReviewIds),
  );

  const unclassifiedTotal = reviewTransactions
    .filter((tx) => Number(tx.amount) > 0)
    .reduce((sum, tx) => sum + Number(tx.amount), 0);

  const unclassifiedCount = reviewTransactions.length;
  const previousUnclassifiedTotal = previousReviewTransactions
    .filter((tx) => Number(tx.amount) > 0)
    .reduce((sum, tx) => sum + Number(tx.amount), 0);

  summaries.push({
    slug: "unclassified",
    name: "Review backlog",
    total: unclassifiedTotal,
    previousMonthTotal: previousUnclassifiedTotal,
    transactionCount: unclassifiedCount,
    unclassifiedCount: unclassifiedCount,
  });

  return summaries;
}

type MatrixTransaction = {
  amount: number;
  transaction_date: string;
  classification: { entity_id: string; category_id: string | null; category?: { id: string; full_path: string } | null };
};

function monthFromDate(date: string) {
  return Number(date.slice(5, 7));
}

async function fetchYearMatrixTransactions(year: number, entityId?: string): Promise<MatrixTransaction[]> {
  const supabase = await createClient();
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year + 1}-01-01`;
  const pageSize = 1000;
  const all: MatrixTransaction[] = [];
  let from = 0;

  while (true) {
    let query = supabase
      .from("transactions")
      .select(
        `
        amount,
        transaction_date,
        classification:classifications!inner(
          entity_id,
          category_id,
          category:categories(id, full_path)
        )
      `,
      )
      .gte("transaction_date", yearStart)
      .lt("transaction_date", yearEnd)
      .order("transaction_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (entityId) {
      query = query.eq("classification.entity_id", entityId);
    }

    const { data, error } = await query;

    if (error) throw error;
    const page = (data ?? []) as MatrixTransaction[];
    all.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }

  return all;
}

function buildMonthlyRow(
  slug: string,
  name: string,
  transactions: MatrixTransaction[],
  options?: { isUnclassified?: boolean },
): MonthlyEntityRow {
  const months: Record<number, number> = {};
  const monthCounts: Record<number, number> = {};
  let ytd = 0;
  let ytdCount = 0;

  for (const tx of transactions) {
    if (Number(tx.amount) <= 0) continue;
    const month = monthFromDate(tx.transaction_date);
    months[month] = (months[month] ?? 0) + Number(tx.amount);
    monthCounts[month] = (monthCounts[month] ?? 0) + 1;
    ytd += Number(tx.amount);
    ytdCount += 1;
  }

  return {
    slug,
    name,
    months,
    monthCounts,
    ytd,
    ytdCount,
    isUnclassified: options?.isUnclassified,
  };
}

export async function getMonthlyEntityMatrix(year: number): Promise<MonthlyEntityRow[]> {
  const supabase = await createClient();

  const [entitiesResult, transactions] = await Promise.all([
    supabase.from("entities").select("id, name, slug, display_order").eq("is_classifiable", true).order("display_order"),
    fetchYearMatrixTransactions(year),
  ]);

  if (entitiesResult.error) throw entitiesResult.error;

  const entities = entitiesResult.data ?? [];
  const cpaReviewIds = await getCpaReviewCategoryIdSet(supabase);

  const entityRows = entities.map((entity) => {
    const entityTransactions = transactions.filter((tx) => tx.classification.entity_id === entity.id);
    return buildMonthlyRow(entity.slug, entity.name, entityTransactions);
  });

  const unclassifiedTransactions = transactions.filter((tx) =>
    needsReviewCategory(tx.classification.category_id, cpaReviewIds),
  );
  const unclassifiedRow = buildMonthlyRow("unclassified", "Review backlog", unclassifiedTransactions, {
    isUnclassified: true,
  });

  return [...entityRows, unclassifiedRow];
}

function buildMonthlyCategoryRow(
  categoryId: string | null,
  categoryName: string,
  transactions: MatrixTransaction[],
  options?: { isUnclassified?: boolean },
): MonthlyCategoryRow {
  const months: Record<number, number> = {};
  const monthCounts: Record<number, number> = {};
  let ytd = 0;
  let ytdCount = 0;

  for (const tx of transactions) {
    if (Number(tx.amount) <= 0) continue;
    const month = monthFromDate(tx.transaction_date);
    months[month] = (months[month] ?? 0) + Number(tx.amount);
    monthCounts[month] = (monthCounts[month] ?? 0) + 1;
    ytd += Number(tx.amount);
    ytdCount += 1;
  }

  return {
    categoryId,
    categoryName,
    months,
    monthCounts,
    ytd,
    ytdCount,
    isUnclassified: options?.isUnclassified,
  };
}

export async function getMonthlyCategoryMatrix(entitySlug: string, year: number): Promise<MonthlyCategoryRow[]> {
  if (entitySlug === "unclassified") {
    return [];
  }

  const supabase = await createClient();
  const { data: entity, error: entityError } = await supabase
    .from("entities")
    .select("id")
    .eq("slug", entitySlug)
    .single();

  if (entityError || !entity) {
    return [];
  }

  const transactions = await fetchYearMatrixTransactions(year, entity.id);
  const cpaReviewIds = await getCpaReviewCategoryIdSet(supabase);
  const byCategory = new Map<string, MatrixTransaction[]>();
  const unclassified: MatrixTransaction[] = [];

  for (const tx of transactions) {
    const categoryId = tx.classification.category_id;
    if (needsReviewCategory(categoryId, cpaReviewIds)) {
      unclassified.push(tx);
      continue;
    }
    if (!categoryId) continue;
    const bucket = byCategory.get(categoryId) ?? [];
    bucket.push(tx);
    byCategory.set(categoryId, bucket);
  }

  const categoryRows: MonthlyCategoryRow[] = [];

  for (const [categoryId, categoryTransactions] of byCategory.entries()) {
    const name =
      categoryTransactions[0]?.classification.category?.full_path ?? "Unknown category";
    categoryRows.push(buildMonthlyCategoryRow(categoryId, name, categoryTransactions));
  }

  categoryRows.sort((a, b) => b.ytd - a.ytd);

  if (unclassified.length > 0) {
    categoryRows.push(
      buildMonthlyCategoryRow(null, "Uncategorized", unclassified, { isUnclassified: true }),
    );
  }

  return categoryRows;
}

export async function getCategoriesForEntity(entitySlug: string) {
  const supabase = await createClient();

  if (entitySlug === "unclassified") {
    return [];
  }

  const { data: entity, error: entityError } = await supabase
    .from("entities")
    .select("id")
    .eq("slug", entitySlug)
    .single();

  if (entityError || !entity) {
    return [];
  }

  const { data, error } = await supabase
    .from("categories")
    .select("id, full_path, name")
    .eq("entity_id", entity.id)
    .eq("is_active", true)
    .order("full_path");

  if (error) throw error;
  return data ?? [];
}

export async function getCategoriesByEntity() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .select("id, full_path, name, entity:entities!inner(slug)")
    .eq("is_active", true)
    .order("full_path");

  if (error) throw error;

  const categoriesByEntity: Record<string, Array<{ id: string; full_path: string; name: string }>> = {};
  for (const row of data ?? []) {
    const slug = row.entity.slug;
    if (!categoriesByEntity[slug]) {
      categoriesByEntity[slug] = [];
    }
    categoriesByEntity[slug].push({
      id: row.id,
      full_path: row.full_path,
      name: row.name,
    });
  }

  return categoriesByEntity;
}

export async function getEntityTransactions(
  period: PeriodRange,
  entitySlug: string,
  categoryFilter?: string | null,
): Promise<{ groups: CategoryGroup[]; transactions: TransactionWithDetails[] }> {
  const supabase = await createClient();
  const { start, end } = period;
  const cpaReviewIds = await getCpaReviewCategoryIdSet(supabase);

  let query = supabase
    .from("transactions")
    .select(TRANSACTION_SELECT)
    .gte("transaction_date", start)
    .lt("transaction_date", end)
    .order("transaction_date", { ascending: false });

  if (entitySlug !== "unclassified") {
    const { data: entity, error: entityError } = await supabase
      .from("entities")
      .select("id")
      .eq("slug", entitySlug)
      .single();

    if (entityError) throw entityError;
    query = query.eq("classification.entity_id", entity.id);
  }

  if (categoryFilter === "unclassified") {
    // filtered after fetch — includes CPA review bucket
  } else if (categoryFilter) {
    query = query.eq("classification.category_id", categoryFilter);
  }

  const { data, error } = await query;
  if (error) throw error;

  let transactions = (data ?? []) as unknown as TransactionWithDetails[];

  if (entitySlug === "unclassified" || categoryFilter === "unclassified") {
    transactions = transactions.filter((tx) =>
      needsReviewCategory(tx.classification.category_id, cpaReviewIds),
    );
  }
  const groupMap = new Map<string, CategoryGroup>();

  for (const tx of transactions) {
    const categoryId = tx.classification.category?.id ?? null;
    const categoryName = isCpaReviewCategory(tx.classification.category?.full_path)
      ? "Ask My Accountant (CPA review)"
      : (tx.classification.category?.full_path ?? "Uncategorized");
    const key = categoryId ?? "unclassified";

    const existing = groupMap.get(key);
    if (existing) {
      existing.total += Number(tx.amount);
      existing.transactions.push(tx);
    } else {
      groupMap.set(key, {
        categoryId,
        categoryName,
        total: Number(tx.amount),
        transactions: [tx],
      });
    }
  }

  const groups = Array.from(groupMap.values()).sort((a, b) => b.total - a.total);

  return { groups, transactions };
}

export async function getTransactionById(id: string): Promise<TransactionWithDetails | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("transactions").select(TRANSACTION_SELECT).eq("id", id).maybeSingle();

  if (error) throw error;
  return (data as unknown as TransactionWithDetails | null) ?? null;
}
