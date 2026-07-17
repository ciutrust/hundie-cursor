import type { SupabaseClient } from "@supabase/supabase-js";
import { TRANSACTION_SELECT, hydrateTransactionSplits } from "@/lib/queries/review";
import { paginateAll } from "@/lib/supabase/paginate";
import { createClient } from "@/lib/supabase/server";
import type { TransactionWithDetails } from "@/lib/types/database";

export type ExpenseReportRow = {
  id: string;
  number: number;
  name: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
};

export type ExpenseReportSummary = ExpenseReportRow & {
  transactionCount: number;
  /** Signed sum of member amounts (charges are positive outflows in this ledger). */
  total: number;
};

/**
 * `expense_reports` + `transactions.expense_report_id` are not in the generated Database type yet
 * (types are regenerated out-of-band), so reads go through one narrow cast — the same pattern
 * lib/queries/proposals.ts and hydrateTransactionSplits already use for transaction_splits.
 */
function db(supabase: Awaited<ReturnType<typeof createClient>>) {
  return supabase as unknown as SupabaseClient;
}

const REPORT_SELECT = "id, number, name, notes, created_by, created_at";

/** All expense reports, newest number first, each with its line count + total. */
export async function getExpenseReports(): Promise<ExpenseReportSummary[]> {
  const supabase = await createClient();

  const { data, error } = await db(supabase)
    .from("expense_reports")
    .select(REPORT_SELECT)
    .order("number", { ascending: false });
  if (error) throw error;

  const reports = (data ?? []) as unknown as ExpenseReportRow[];
  if (reports.length === 0) return [];

  // Aggregate member rows in JS (one scan beats a view or N queries). PAGINATED: this spans members of
  // EVERY report, not one trip, so it blows past PostgREST's 1000-row cap after ~20 trips and would
  // silently understate every count + total (the BUG-05 / OPT-02 class). `.order("id")` is the unique
  // tiebreaker offset paging needs; `key` makes paginateAll throw if a row is ever seen twice.
  type MemberRow = { id: string; expense_report_id: string; amount: number | string };
  const members = await paginateAll<MemberRow>(
    async (from, size) => {
      const { data, error } = await db(supabase)
        .from("transactions")
        .select("id, expense_report_id, amount")
        .not("expense_report_id", "is", null)
        .order("id")
        .range(from, from + size - 1);
      return { data: data as unknown as MemberRow[] | null, error };
    },
    1000,
    (row) => row.id,
  );

  const stats = new Map<string, { count: number; total: number }>();
  for (const row of members) {
    const current = stats.get(row.expense_report_id) ?? { count: 0, total: 0 };
    current.count += 1;
    current.total += Number(row.amount);
    stats.set(row.expense_report_id, current);
  }

  return reports.map((report) => ({
    ...report,
    transactionCount: stats.get(report.id)?.count ?? 0,
    total: stats.get(report.id)?.total ?? 0,
  }));
}

/** One report plus its line items, addressed by the human-facing number (0001 -> 1). */
export async function getExpenseReportByNumber(
  reportNumber: number,
): Promise<{ report: ExpenseReportRow; transactions: TransactionWithDetails[] } | null> {
  const supabase = await createClient();

  const { data, error } = await db(supabase)
    .from("expense_reports")
    .select(REPORT_SELECT)
    .eq("number", reportNumber)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const report = data as unknown as ExpenseReportRow;

  // Paginated + `.order("id")` after the date sort: reports are trip-sized by design, but nothing
  // enforces that (a wide date range can be saved in one go), and dates tie constantly — without a
  // unique tiebreaker offset paging drops/duplicates rows the moment a report exceeds one page.
  const transactions = await paginateAll<TransactionWithDetails>(
    async (from, size) => {
      const { data, error } = await db(supabase)
        .from("transactions")
        .select(TRANSACTION_SELECT)
        .eq("expense_report_id", report.id)
        .order("transaction_date", { ascending: false })
        .order("id")
        .range(from, from + size - 1);
      return { data: data as unknown as TransactionWithDetails[] | null, error };
    },
    1000,
    (row) => row.id,
  );

  await hydrateTransactionSplits(supabase, transactions);

  return { report, transactions };
}
