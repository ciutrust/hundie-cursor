import type { PeriodRange } from "@/lib/period";
import { needsCategoryReview } from "@/lib/category-review";
import { isOperatingExpense } from "@/lib/category-expense";
import { createClient } from "@/lib/supabase/server";

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
  const pageSize = 1000;
  const all: Array<{
    amount: number;
    classification: {
      entity_id: string;
      category_id: string | null;
      entity: { name: string; slug: string };
      category: { full_path: string } | null;
    };
  }> = [];
  let from = 0;

  while (true) {
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

    if (error) throw error;
    const page = data ?? [];
    all.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }

  return all;
}

export async function getReportTransactions(period: PeriodRange): Promise<ReportTransactionRow[]> {
  const supabase = await createClient();
  const { start, end } = period;
  const pageSize = 1000;
  const all: ReportTransactionRow[] = [];
  let from = 0;

  while (true) {
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

    if (error) throw error;
    const page =
      data?.map((row) => ({
        transaction_date: row.transaction_date,
        entity_name: row.classification.entity.name,
        entity_slug: row.classification.entity.slug,
        account_name: row.account.display_name,
        description: row.description,
        vendor: row.vendor,
        amount: Number(row.amount),
        category_name: row.classification.category?.full_path ?? "Uncategorized",
        notes: row.classification.notes,
      })) ?? [];

    all.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }

  return all;
}

export function reportTransactionsToCsv(rows: ReportTransactionRow[]) {
  const header = [
    "date",
    "entity",
    "account",
    "vendor",
    "description",
    "amount",
    "category",
    "notes",
  ];
  const escape = (value: string | number | null) => {
    const text = value == null ? "" : String(value);
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  };
  const lines = [
    header.join(","),
    ...rows.map((row) =>
      [
        row.transaction_date,
        row.entity_name,
        row.account_name,
        row.vendor,
        row.description,
        row.amount.toFixed(2),
        row.category_name,
        row.notes,
      ]
        .map(escape)
        .join(","),
    ),
  ];
  return lines.join("\n");
}
