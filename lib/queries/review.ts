import { createClient } from "@/lib/supabase/server";
import type { CategoryGroup, EntitySummary, MonthlyEntityRow, TransactionWithDetails } from "@/lib/types/database";
import { monthBounds } from "@/lib/utils";

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

export async function getEntitySummaries(year: number, month: number): Promise<EntitySummary[]> {
  const supabase = await createClient();
  const { start, end } = monthBounds(year, month);
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const { start: prevStart, end: prevEnd } = monthBounds(prevYear, prevMonth);

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
      .gte("transaction_date", prevStart)
      .lt("transaction_date", prevEnd),
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
      unclassifiedCount: entityTransactions.filter((tx) => !tx.classification.category_id).length,
    };
  });

  const unclassifiedTotal = transactions
    .filter((tx) => !tx.classification.category_id && Number(tx.amount) > 0)
    .reduce((sum, tx) => sum + Number(tx.amount), 0);

  const unclassifiedCount = transactions.filter((tx) => !tx.classification.category_id).length;
  const previousUnclassifiedTotal = previousTransactions
    .filter((tx) => !tx.classification.category_id && Number(tx.amount) > 0)
    .reduce((sum, tx) => sum + Number(tx.amount), 0);

  summaries.push({
    slug: "unclassified",
    name: "Unclassified",
    total: unclassifiedTotal,
    previousMonthTotal: previousUnclassifiedTotal,
    transactionCount: unclassifiedCount,
    unclassifiedCount: unclassifiedCount,
  });

  return summaries;
}

export async function getMonthlyEntityMatrix(year: number): Promise<MonthlyEntityRow[]> {
  const supabase = await createClient();
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year + 1}-01-01`;

  const [entitiesResult, transactionsResult] = await Promise.all([
    supabase.from("entities").select("id, name, slug, display_order").eq("is_classifiable", true).order("display_order"),
    supabase
      .from("transactions")
      .select(
        `
        amount,
        transaction_date,
        classification:classifications!inner(
          entity_id
        )
      `,
      )
      .gte("transaction_date", yearStart)
      .lt("transaction_date", yearEnd),
  ]);

  if (entitiesResult.error) throw entitiesResult.error;
  if (transactionsResult.error) throw transactionsResult.error;

  const entities = entitiesResult.data ?? [];
  const transactions = transactionsResult.data ?? [];

  return entities.map((entity) => {
    const months: Record<number, number> = {};
    let ytd = 0;

    for (const tx of transactions) {
      if (tx.classification.entity_id !== entity.id || Number(tx.amount) <= 0) continue;
      const month = new Date(`${tx.transaction_date}T12:00:00`).getMonth() + 1;
      months[month] = (months[month] ?? 0) + Number(tx.amount);
      ytd += Number(tx.amount);
    }

    return {
      slug: entity.slug,
      name: entity.name,
      months,
      ytd,
    };
  });
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
  year: number,
  month: number,
  entitySlug: string,
  categoryFilter?: string | null,
): Promise<{ groups: CategoryGroup[]; transactions: TransactionWithDetails[] }> {
  const supabase = await createClient();
  const { start, end } = monthBounds(year, month);

  let query = supabase
    .from("transactions")
    .select(TRANSACTION_SELECT)
    .gte("transaction_date", start)
    .lt("transaction_date", end)
    .order("transaction_date", { ascending: false });

  if (entitySlug === "unclassified") {
    query = query.is("classification.category_id", null);
  } else {
    const { data: entity, error: entityError } = await supabase
      .from("entities")
      .select("id")
      .eq("slug", entitySlug)
      .single();

    if (entityError) throw entityError;
    query = query.eq("classification.entity_id", entity.id);
  }

  if (categoryFilter === "unclassified") {
    query = query.is("classification.category_id", null);
  } else if (categoryFilter) {
    query = query.eq("classification.category_id", categoryFilter);
  }

  const { data, error } = await query;
  if (error) throw error;

  let transactions = (data ?? []) as unknown as TransactionWithDetails[];
  const groupMap = new Map<string, CategoryGroup>();

  for (const tx of transactions) {
    const categoryId = tx.classification.category?.id ?? null;
    const categoryName = tx.classification.category?.full_path ?? "Unclassified";
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
