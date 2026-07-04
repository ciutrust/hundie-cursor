import type { PeriodRange } from "@/lib/period";
import { countsAsExpense, isBookedOperatingExpense } from "@/lib/category-expense";
import {
  getCpaReviewCategoryIdSet,
  isCpaReviewCategory,
  needsReviewCategory,
  reviewBacklogOrClause,
} from "@/lib/category-review";
import { createClient } from "@/lib/supabase/server";
import type { MonthCloseCell } from "@/lib/month-close";
import { getAiPreclassifiedCount } from "@/lib/queries/ai-suggestions";
import { fetchPeriodTransactions } from "@/lib/queries/fetch-period-transactions";
import { fetchOrphanCountsByEntityMonth, UNASSIGNED_ENTITY_KEY } from "@/lib/queries/orphans";
import { fetchChangedTransactionIds } from "@/lib/queries/transaction-history";
import type { CategoryGroup, EntitySummary, MonthlyCategoryRow, MonthlyEntityRow, ReviewDashboardStats, TransactionWithDetails } from "@/lib/types/database";
const TRANSACTION_SELECT = `
  id,
  transaction_date,
  amount,
  description,
  vendor,
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

const SUMMARY_TRANSACTION_SELECT = `
  id,
  amount,
  classification:classifications!inner(
    entity_id,
    category_id,
    category:categories(full_path)
  )
`;

type SummaryTransaction = {
  id: string;
  amount: number;
  classification: {
    entity_id: string;
    category_id: string | null;
    category?: { full_path: string } | null;
  };
};

function fetchPeriodSummaryTransactions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  start: string,
  end: string,
  options?: { entityId?: string },
): Promise<SummaryTransaction[]> {
  // OPT-08: same select/filters/ascending order as before, now via the shared fetcher.
  return fetchPeriodTransactions<SummaryTransaction>({
    supabase,
    select: SUMMARY_TRANSACTION_SELECT,
    start,
    end,
    entityId: options?.entityId,
    order: "asc",
  });
}

function fetchPeriodTransactionDetails(
  supabase: Awaited<ReturnType<typeof createClient>>,
  start: string,
  end: string,
  options?: { entityId?: string; categoryId?: string },
): Promise<TransactionWithDetails[]> {
  // OPT-08: descending order is load-bearing — getEntityTransactions returns this array to the UI.
  return fetchPeriodTransactions<TransactionWithDetails>({
    supabase,
    select: TRANSACTION_SELECT,
    start,
    end,
    entityId: options?.entityId,
    categoryId: options?.categoryId,
    order: "desc",
  });
}

function isNullCategory(categoryId: string | null | undefined) {
  return !categoryId;
}

function isAmaCategory(categoryId: string | null | undefined, cpaReviewIds: Set<string>) {
  return categoryId != null && cpaReviewIds.has(categoryId);
}

export function buildReviewDashboardStats(
  summaries: EntitySummary[],
  transactions: Array<{ classification: { category_id: string | null } }>,
  cpaReviewIds: Set<string>,
  aiPreclassifiedCount = 0,
): ReviewDashboardStats {
  const entitySummaries = summaries.filter((summary) => summary.slug !== "unclassified");
  const grandTotal = entitySummaries.reduce((sum, summary) => sum + summary.total, 0);
  const previousGrandTotal = entitySummaries.reduce(
    (sum, summary) => sum + (summary.previousMonthTotal ?? 0),
    0,
  );
  const totalTransactions = entitySummaries.reduce((sum, summary) => sum + summary.transactionCount, 0);
  const unclassifiedCount = transactions.filter((tx) => isNullCategory(tx.classification.category_id)).length;
  const amaCount = transactions.filter((tx) =>
    isAmaCategory(tx.classification.category_id, cpaReviewIds),
  ).length;
  const taxReady = entitySummaries.filter((summary) => summary.unclassifiedCount === 0);

  return {
    grandTotal,
    previousGrandTotal,
    totalTransactions,
    unclassifiedCount,
    amaCount,
    aiPreclassifiedCount,
    taxReadyCount: taxReady.length,
    taxReadyNames: taxReady.map((summary) => summary.name.split(",")[0]?.trim() ?? summary.name),
    classifiableEntityCount: entitySummaries.length,
  };
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

export type CategorizationProgress = {
  total: number;
  categorized: number;
  aiAccepted: number;
  aiAcceptRate: number | null;
  deterministicAccepted: number;
};

/** Cumulative, all-time categorization progress + how much came from accepting suggestions. */
export async function getCategorizationProgress(): Promise<CategorizationProgress> {
  const supabase = await createClient();

  // C8: grouped HEAD counts instead of streaming the entire (unbounded, append-only) suggestion_events
  // table on every /review load. Each predicate mirrors the old JS counter exactly.
  const DETERMINISTIC = ["qb_training", "confirmed_history", "blended", "amount_match"];
  const [
    { count: total },
    { count: categorized },
    { count: aiAcc },
    { count: aiRej },
    { count: detAcc },
  ] = await Promise.all([
    supabase.from("classifications").select("id", { count: "exact", head: true }),
    supabase.from("classifications").select("id", { count: "exact", head: true }).not("category_id", "is", null),
    supabase.from("suggestion_events").select("id", { count: "exact", head: true }).eq("suggestion_source", "ai_llm").eq("event_type", "accept"),
    supabase.from("suggestion_events").select("id", { count: "exact", head: true }).eq("suggestion_source", "ai_llm").eq("event_type", "reject"),
    supabase.from("suggestion_events").select("id", { count: "exact", head: true }).eq("event_type", "accept").in("suggestion_source", DETERMINISTIC),
  ]);

  const aiAccepted = aiAcc ?? 0;
  const aiRejected = aiRej ?? 0;
  return {
    total: total ?? 0,
    categorized: categorized ?? 0,
    aiAccepted,
    aiAcceptRate: aiAccepted + aiRejected > 0 ? aiAccepted / (aiAccepted + aiRejected) : null,
    deterministicAccepted: detAcc ?? 0,
  };
}

function buildEntitySummaries(
  entities: Array<{ id: string; name: string; slug: string }>,
  transactions: SummaryTransaction[],
  previousTransactions: SummaryTransaction[],
  cpaReviewIds: Set<string>,
): EntitySummary[] {
  const summaries = entities.map((entity) => {
    const entityTransactions = transactions.filter(
      (tx) => tx.classification.entity_id === entity.id,
    );
    const previousEntityTransactions = previousTransactions.filter(
      (tx) => tx.classification.entity_id === entity.id,
    );
    // BUG-04/QA-01: book by category kind (sign-independent) + SIGNED sum so a refund
    // in an expense category nets its charge. Routes through the single shared predicate
    // so /review and /reports agree. (Refunds > charges may make this legitimately negative.)
    const expenseTotal = entityTransactions
      .filter((tx) => isBookedOperatingExpense(tx.classification.category?.full_path))
      .reduce((sum, tx) => sum + Number(tx.amount), 0);
    const previousExpenseTotal = previousEntityTransactions
      .filter((tx) => isBookedOperatingExpense(tx.classification.category?.full_path))
      .reduce((sum, tx) => sum + Number(tx.amount), 0);

    // NOTE: once refunds net (above), grossTotal (positive-only) no longer equals
    // expenseTotal + excludedTotal + unclassifiedTotal. grossTotal reconciles the
    // POSITIVE buckets; expenseTotal is the NET P&L number. This is correct.
    const positive = entityTransactions.filter((tx) => Number(tx.amount) > 0);
    const grossTotal = positive.reduce((sum, tx) => sum + Number(tx.amount), 0);
    const excludedTotal = positive
      .filter(
        (tx) =>
          !needsReviewCategory(tx.classification.category_id, cpaReviewIds) &&
          !countsAsExpense(tx.classification.category?.full_path),
      )
      .reduce((sum, tx) => sum + Number(tx.amount), 0);
    const unclassifiedTotal = positive
      .filter((tx) => needsReviewCategory(tx.classification.category_id, cpaReviewIds))
      .reduce((sum, tx) => sum + Number(tx.amount), 0);

    return {
      slug: entity.slug,
      name: entity.name,
      total: expenseTotal,
      previousMonthTotal: previousEntityTransactions.length > 0 ? previousExpenseTotal : 0,
      transactionCount: entityTransactions.length,
      unclassifiedCount: entityTransactions.filter(
        (tx) =>
          needsReviewCategory(tx.classification.category_id, cpaReviewIds) && Number(tx.amount) > 0,
      ).length,
      grossTotal,
      excludedTotal,
      unclassifiedTotal,
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
    grossTotal: unclassifiedTotal,
    excludedTotal: 0,
    unclassifiedTotal,
  });

  return summaries;
}

export async function getEntitySummaries(period: PeriodRange): Promise<EntitySummary[]> {
  const supabase = await createClient();
  const { start, end, compareStart, compareEnd } = period;

  const [cpaReviewIds, entitiesResult, transactions, previousTransactions] = await Promise.all([
    getCpaReviewCategoryIdSet(supabase),
    supabase.from("entities").select("id, name, slug, display_order").eq("is_classifiable", true).order("display_order"),
    fetchPeriodSummaryTransactions(supabase, start, end),
    fetchPeriodSummaryTransactions(supabase, compareStart, compareEnd),
  ]);

  if (entitiesResult.error) throw entitiesResult.error;

  return buildEntitySummaries(entitiesResult.data ?? [], transactions, previousTransactions, cpaReviewIds);
}

export async function getReviewDashboardStats(
  period: PeriodRange,
): Promise<ReviewDashboardStats & { summaries: EntitySummary[] }> {
  const supabase = await createClient();
  const { start, end, compareStart, compareEnd } = period;

  // OPT-05: fetch the current period ONCE and reuse it for both the per-entity summaries
  // and the dashboard counts (the old code fetched it twice, plus cpaReviewIds twice).
  const [cpaReviewIds, entitiesResult, transactions, previousTransactions, aiPreclassifiedCount] =
    await Promise.all([
      getCpaReviewCategoryIdSet(supabase),
      supabase.from("entities").select("id, name, slug, display_order").eq("is_classifiable", true).order("display_order"),
      fetchPeriodSummaryTransactions(supabase, start, end),
      fetchPeriodSummaryTransactions(supabase, compareStart, compareEnd),
      getAiPreclassifiedCount(),
    ]);

  if (entitiesResult.error) throw entitiesResult.error;

  const summaries = buildEntitySummaries(
    entitiesResult.data ?? [],
    transactions,
    previousTransactions,
    cpaReviewIds,
  );

  return {
    ...buildReviewDashboardStats(summaries, transactions, cpaReviewIds, aiPreclassifiedCount),
    summaries,
  };
}

export async function getTotalBacklogCount(): Promise<number> {
  const supabase = await createClient();
  const cpaReviewIds = await getCpaReviewCategoryIdSet(supabase);

  // BUG-14/OPT-06: push the predicate into SQL with a head/count aggregate instead of
  // streaming the entire transactions table into Node just to count it.
  const { count, error } = await supabase
    .from("transactions")
    .select("id, classification:classifications!inner(category_id)", { count: "exact", head: true })
    // C4: a Plaid-reversed charge is not backlog to clear — exclude it from the count.
    .is("plaid_removed_at", null)
    .or(reviewBacklogOrClause(cpaReviewIds));

  if (error) throw error;
  return count ?? 0;
}

export async function getDormantEntities() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("entities")
    .select("name, slug, status")
    .eq("is_classifiable", false)
    .order("display_order");

  if (error) throw error;
  return data ?? [];
}

type MatrixTransaction = {
  id: string;
  amount: number;
  transaction_date: string;
  classification: { entity_id: string; category_id: string | null; category?: { id: string; full_path: string } | null };
};

function monthFromDate(date: string) {
  return Number(date.slice(5, 7));
}

const MATRIX_SELECT = `
  id,
  amount,
  transaction_date,
  classification:classifications!inner(
    entity_id,
    category_id,
    category:categories(id, full_path)
  )
`;

async function fetchYearMatrixTransactions(year: number, entityId?: string): Promise<MatrixTransaction[]> {
  const supabase = await createClient();
  // OPT-08: same select/filters/ascending order over the [year, year+1) window.
  return fetchPeriodTransactions<MatrixTransaction>({
    supabase,
    select: MATRIX_SELECT,
    start: `${year}-01-01`,
    end: `${year + 1}-01-01`,
    entityId,
    order: "asc",
  });
}

export function buildMonthlyRow(
  slug: string,
  name: string,
  transactions: MatrixTransaction[],
  options?: { isUnclassified?: boolean; expenseOnly?: boolean },
): MonthlyEntityRow {
  const months: Record<number, number> = {};
  const monthCounts: Record<number, number> = {};
  let ytd = 0;
  let ytdCount = 0;

  for (const tx of transactions) {
    if (options?.expenseOnly) {
      // Expense row: book by category kind (sign-independent) + SIGNED sum so refunds net (BUG-04).
      // AMA is a review category → excluded here, so it no longer double-counts with the backlog row (QA-04).
      if (!isBookedOperatingExpense(tx.classification.category?.full_path)) continue;
    } else if (Number(tx.amount) <= 0) {
      // Review-backlog row: gross positive "$ to classify" (matches getEntitySummaries.unclassifiedTotal).
      continue;
    }
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
    return buildMonthlyRow(entity.slug, entity.name, entityTransactions, { expenseOnly: true });
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
  options?: { isUnclassified?: boolean; expenseOnly?: boolean },
): MonthlyCategoryRow {
  const months: Record<number, number> = {};
  const monthCounts: Record<number, number> = {};
  let ytd = 0;
  let ytdCount = 0;

  for (const tx of transactions) {
    if (options?.expenseOnly) {
      // Expense category row: book by kind (sign-independent) + SIGNED sum so refunds net, mirroring
      // the entity expense rows in getMonthlyEntityMatrix so spending-by-category reconciles with
      // spending-by-entity and non-expense kinds (transfers/income/funding/capital) are excluded (BUG-04/QA-01).
      if (!isBookedOperatingExpense(tx.classification.category?.full_path)) continue;
    } else if (Number(tx.amount) <= 0) {
      // Uncategorized row: gross positive "$ to classify", matching the entity Review-backlog row.
      continue;
    }
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
    const row = buildMonthlyCategoryRow(categoryId, name, categoryTransactions, { expenseOnly: true });
    // A non-expense-kind category (transfer/income/funding/capital) nets to an empty expense row — drop it.
    if (row.ytdCount > 0) categoryRows.push(row);
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
  /** Which side of the backlog: outflows (expense, default) or inflows (income to classify). */
  flow: "outflow" | "inflow" = "outflow",
): Promise<{ groups: CategoryGroup[]; transactions: TransactionWithDetails[] }> {
  const supabase = await createClient();
  const { start, end } = period;
  const cpaReviewIds = await getCpaReviewCategoryIdSet(supabase);

  let entityId: string | undefined;
  if (entitySlug !== "unclassified") {
    const { data: entity, error: entityError } = await supabase
      .from("entities")
      .select("id")
      .eq("slug", entitySlug)
      .single();

    if (entityError) throw entityError;
    entityId = entity.id;
  }

  let transactions = await fetchPeriodTransactionDetails(supabase, start, end, {
    entityId,
    categoryId:
      categoryFilter && categoryFilter !== "unclassified" ? categoryFilter : undefined,
  });

  if (entitySlug === "unclassified" || categoryFilter === "unclassified") {
    if (entitySlug === "unclassified") {
      transactions = await fetchPeriodTransactionDetails(supabase, start, end);
    }
    transactions = transactions.filter(
      (tx) =>
        needsReviewCategory(tx.classification.category_id, cpaReviewIds) &&
        (flow === "inflow" ? Number(tx.amount) < 0 : Number(tx.amount) > 0),
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
  // OPT-11: one intentional narrow cast. PostgREST types embedded to-one joins as arrays,
  // but the runtime shape of the shared TRANSACTION_SELECT literal matches TransactionWithDetails.
  return (data as unknown as TransactionWithDetails | null) ?? null;
}

export type MonthCloseEntityRow = {
  slug: string;
  name: string;
  months: Record<number, MonthCloseCell>;
};

/**
 * C9: orphans whose account has NO default entity (or is unknown) bucket here. Surfaced as a
 * dedicated pseudo-row so they aren't silently lost — an orphan-only "unassigned" month still reads
 * OPEN. Its slug intentionally can't collide with a real entity slug.
 */
export const UNASSIGNED_MONTH_CLOSE_SLUG = "__unassigned__";

function emptyMonthCells(): Record<number, MonthCloseCell> {
  const months: Record<number, MonthCloseCell> = {};
  for (let m = 1; m <= 12; m += 1)
    months[m] = { hasActivity: false, backlogCount: 0, orphanCount: 0, changedCount: 0 };
  return months;
}

/** Per classifiable entity x month: activity + backlog (unclassified + AMA) for Month/Tax Close. */
export async function getMonthCloseMatrix(year: number): Promise<MonthCloseEntityRow[]> {
  const supabase = await createClient();
  const [entitiesResult, transactions, cpaReviewIds, orphanCounts, changedIds] = await Promise.all([
    supabase
      .from("entities")
      .select("id, name, slug, display_order")
      .eq("is_classifiable", true)
      .order("display_order"),
    fetchYearMatrixTransactions(year),
    getCpaReviewCategoryIdSet(supabase),
    // C9: SEPARATE orphan count (transactions with no classifications row). The report path keeps
    // its `!inner` embed; orphan visibility lives only in the close/backlog path.
    fetchOrphanCountsByEntityMonth(supabase, year),
    // C8: ids of transactions whose amount/date/description was edited after the fact (audit trail).
    // FAIL-SOFT: returns an empty Set if the transaction_history table is not yet applied.
    fetchChangedTransactionIds(supabase, year),
  ]);
  if (entitiesResult.error) throw entitiesResult.error;
  const entities = entitiesResult.data ?? [];

  const rows: MonthCloseEntityRow[] = entities.map((entity) => {
    const months = emptyMonthCells();
    for (const tx of transactions) {
      if (tx.classification.entity_id !== entity.id) continue;
      const cell = months[monthFromDate(tx.transaction_date)];
      cell.hasActivity = true;
      if (needsReviewCategory(tx.classification.category_id, cpaReviewIds)) {
        cell.backlogCount += 1;
      }
      // C8: a changed-since-close warning is bucketed via the classified loop (v1 scope). A changed
      // ORPHAN is an edge case out of scope (an orphan has no classifications row to have changed
      // meaningfully, and it already keeps the month OPEN via orphanCount).
      if (changedIds.has(tx.id)) {
        cell.changedCount += 1;
      }
    }
    // C9: fold in this entity's orphans — an orphan is unbooked activity that keeps the month OPEN.
    const entityOrphans = orphanCounts.get(entity.id);
    if (entityOrphans) {
      for (const [month, count] of Object.entries(entityOrphans)) {
        const cell = months[Number(month)];
        cell.orphanCount += count;
        cell.hasActivity = true;
      }
    }
    return { slug: entity.slug, name: entity.name, months };
  });

  // C9: orphans on accounts with no default entity (or unknown accounts) — surface as an
  // "Unassigned" pseudo-row so they aren't silently lost. Only add it when there are any.
  const unassignedOrphans = orphanCounts.get(UNASSIGNED_ENTITY_KEY);
  if (unassignedOrphans && Object.keys(unassignedOrphans).length > 0) {
    const months = emptyMonthCells();
    for (const [month, count] of Object.entries(unassignedOrphans)) {
      const cell = months[Number(month)];
      cell.orphanCount += count;
      cell.hasActivity = true;
    }
    rows.push({ slug: UNASSIGNED_MONTH_CLOSE_SLUG, name: "Unassigned (no entity)", months });
  }

  return rows;
}
