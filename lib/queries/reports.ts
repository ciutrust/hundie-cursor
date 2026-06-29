import type { PeriodRange } from "@/lib/period";
import { rowsToCsv } from "@/lib/csv";
import { isBookedOperatingExpense } from "@/lib/category-expense";
import { createClient } from "@/lib/supabase/server";
import { fetchPeriodTransactions } from "@/lib/queries/fetch-period-transactions";

const REPORT_SELECT = `
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
`;

type ReportTxRow = {
  transaction_date: string;
  description: string;
  vendor: string | null;
  amount: number;
  account: { display_name: string };
  classification: {
    notes: string | null;
    entity: { name: string; slug: string };
    category: { full_path: string } | null;
  };
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

export async function getReportTransactions(
  period: PeriodRange,
  entitySlug?: string,
): Promise<ReportTransactionRow[]> {
  const supabase = await createClient();

  // OPT-08: same select/filters/ascending order via the shared period fetcher.
  const rows = await fetchPeriodTransactions<ReportTxRow>({
    supabase,
    select: REPORT_SELECT,
    start: period.start,
    end: period.end,
    entitySlug,
    order: "asc",
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
