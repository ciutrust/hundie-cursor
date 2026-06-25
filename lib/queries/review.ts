import { createClient } from "@/lib/supabase/server";
import type { CategoryGroup, EntitySummary, TransactionWithDetails } from "@/lib/types/database";
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

  const [entitiesResult, transactionsResult] = await Promise.all([
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
  ]);

  if (entitiesResult.error) throw entitiesResult.error;
  if (transactionsResult.error) throw transactionsResult.error;

  const entities = entitiesResult.data ?? [];
  const transactions = transactionsResult.data ?? [];

  const summaries = entities.map((entity) => {
    const entityTransactions = transactions.filter(
      (tx) => tx.classification.entity_id === entity.id,
    );
    const expenseTotal = entityTransactions
      .filter((tx) => Number(tx.amount) > 0)
      .reduce((sum, tx) => sum + Number(tx.amount), 0);

    return {
      slug: entity.slug,
      name: entity.name,
      total: expenseTotal,
      transactionCount: entityTransactions.length,
      unclassifiedCount: entityTransactions.filter((tx) => !tx.classification.category_id).length,
    };
  });

  const unclassifiedTotal = transactions
    .filter((tx) => !tx.classification.category_id && Number(tx.amount) > 0)
    .reduce((sum, tx) => sum + Number(tx.amount), 0);

  const unclassifiedCount = transactions.filter((tx) => !tx.classification.category_id).length;

  summaries.push({
    slug: "unclassified",
    name: "Unclassified",
    total: unclassifiedTotal,
    transactionCount: unclassifiedCount,
    unclassifiedCount: unclassifiedCount,
  });

  return summaries;
}

export async function getCategoriesForEntity(entitySlug: string) {
  const supabase = await createClient();

  if (entitySlug !== "gbsl") {
    return [];
  }

  const { data: entity, error: entityError } = await supabase
    .from("entities")
    .select("id")
    .eq("slug", entitySlug)
    .single();

  if (entityError) throw entityError;

  const { data, error } = await supabase
    .from("categories")
    .select("id, full_path, name")
    .eq("entity_id", entity.id)
    .eq("is_active", true)
    .order("full_path");

  if (error) throw error;
  return data ?? [];
}

export async function getEntityTransactions(
  year: number,
  month: number,
  entitySlug: string,
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

  const { data, error } = await query;
  if (error) throw error;

  const transactions = (data ?? []) as unknown as TransactionWithDetails[];
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
