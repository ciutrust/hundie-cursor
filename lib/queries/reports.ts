import type { PeriodRange } from "@/lib/period";
import { rowsToCsv } from "@/lib/csv";
import { isBookedOperatingExpense } from "@/lib/category-expense";
import { createClient } from "@/lib/supabase/server";
import { paginateAll } from "@/lib/supabase/paginate";

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

export async function getReportTransactions(
  period: PeriodRange,
  entitySlug?: string,
): Promise<ReportTransactionRow[]> {
  const supabase = await createClient();
  const { start, end } = period;

  const rows = await paginateAll(async (from, pageSize) => {
    let query = supabase
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

    if (entitySlug) {
      query = query.eq("classification.entity.slug", entitySlug);
    }

    const { data, error } = await query;
    return { data: data ?? [], error };
  });

  return rows.map((row) => {
    const categoryPath = row.classification.category?.full_path ?? null;
    // BUG-04/QA-01: book by category kind (AMA + uncategorized excluded); signed expense_amount
    // so a refund row exports -50, not 0, and the column sums to the netted entity total.
    const isBooked = isBookedOperatingExpense(categoryPath);
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
      counts_as_expense: isBooked,
      expense_amount: isBooked ? Number(row.amount) : 0,
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
