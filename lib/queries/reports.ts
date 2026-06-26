import type { PeriodRange } from "@/lib/period";
import { rowsToCsv } from "@/lib/csv";
import { needsCategoryReview } from "@/lib/category-review";
import { isOperatingExpense } from "@/lib/category-expense";
import { createClient } from "@/lib/supabase/server";
import { paginateAll } from "@/lib/supabase/paginate";

export type ReportEntityRow = {
  slug: string;
  name: string;
  total: number;
  transactionCount: number;
  unclassifiedCount: number;
  unclassifiedTotal: number;
};

export type ReportTransactionRow = {
  transaction_date: string;
  entity_name: string;
  entity_slug: string;
  account_name: string;
  description: string;
  vendor: string | null;
  amount: number;
  category_name: string;
  notes: string | null;
  counts_as_expense: boolean;
  expense_amount: number;
};

export async function getReportByEntity(period: PeriodRange): Promise<ReportEntityRow[]> {
  const supabase = await createClient();
  const { start, end } = period;

  const [entitiesResult, transactions] = await Promise.all([
    supabase.from("entities").select("id, name, slug, display_order").eq("is_classifiable", true).order("display_order"),
    fetchPeriodSummaryTransactionsForReports(supabase, start, end),
  ]);

  if (entitiesResult.error) throw entitiesResult.error;

  const entities = entitiesResult.data ?? [];

  return entities.map((entity) => {
    const entityTransactions = transactions.filter((tx) => tx.classification.entity_id === entity.id);
    const unclassified = entityTransactions.filter((tx) =>
      needsCategoryReview(tx.classification.category?.full_path),
    );
    return {
      slug: entity.slug,
      name: entity.name,
      total: entityTransactions
        .filter((tx) => isOperatingExpense(tx.amount, tx.classification.category?.full_path))
        .reduce((sum, tx) => sum + Number(tx.amount), 0),
      transactionCount: entityTransactions.length,
      unclassifiedCount: unclassified.length,
      unclassifiedTotal: unclassified
        .filter((tx) => Number(tx.amount) > 0)
        .reduce((sum, tx) => sum + Number(tx.amount), 0),
    };
  });
}

async function fetchPeriodSummaryTransactionsForReports(
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>,
  start: string,
  end: string,
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
          entity:entities!inner(name, slug),
          category:categories(full_path)
        )
      `,
      )
      .gte("transaction_date", start)
      .lt("transaction_date", end)
      .order("transaction_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);

    return { data: data ?? [], error };
  });
}

export async function getReportTransactions(period: PeriodRange): Promise<ReportTransactionRow[]> {
  const supabase = await createClient();
  const { start, end } = period;

  const rows = await paginateAll(async (from, pageSize) => {
    const { data, error } = await supabase
      .from("transactions")
      .select(
        `
        transaction_date,
        description,
        vendor,
        amount,
        account:accounts!inner(display_name),
        classification:classifications!inner(
          notes,
          entity:entities!inner(name, slug),
          category:categories(full_path)
        )
      `,
      )
      .gte("transaction_date", start)
      .lt("transaction_date", end)
      .order("transaction_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);

    return { data: data ?? [], error };
  });

  return rows.map((row) => {
    const categoryPath = row.classification.category?.full_path ?? null;
    const countsAsExpense = isOperatingExpense(row.amount, categoryPath);
    return {
      transaction_date: row.transaction_date,
      entity_name: row.classification.entity.name,
      entity_slug: row.classification.entity.slug,
      account_name: row.account.display_name,
      description: row.description,
      vendor: row.vendor,
      amount: Number(row.amount),
      category_name: categoryPath ?? "Uncategorized",
      notes: row.classification.notes,
      counts_as_expense: countsAsExpense,
      expense_amount: countsAsExpense ? Number(row.amount) : 0,
    };
  });
}

export function reportTransactionsToCsv(rows: ReportTransactionRow[]) {
  const header = [
    "date",
    "entity",
    "account",
    "vendor",
    "description",
    "amount",
    "counts_as_expense",
    "expense_amount",
    "category",
    "notes",
  ];
  return rowsToCsv(
    header,
    rows.map((row) => [
      row.transaction_date,
      row.entity_name,
      row.account_name,
      row.vendor,
      row.description,
      row.amount.toFixed(2),
      row.counts_as_expense ? "yes" : "no",
      row.expense_amount.toFixed(2),
      row.category_name,
      row.notes,
    ]),
  );
}
