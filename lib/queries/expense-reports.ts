import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildExpenseReportLines,
  sumExpenseReportLines,
  type ExpenseReportLine,
  type ExpenseReportTotals,
  type MemberCapture,
  type MemberTransaction,
} from "@/lib/expense-report-lines";
import { paginateAll } from "@/lib/supabase/paginate";
import { createClient } from "@/lib/supabase/server";

export type ExpenseReportRow = {
  id: string;
  number: number;
  name: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  /** null = UNPAID (amber); set = PAID (green). */
  paid_at: string | null;
};

export type ExpenseReportSummary = ExpenseReportRow & ExpenseReportTotals;

/**
 * `expense_reports` / `expense_captures` / the new overlay columns aren't in the generated Database
 * type yet, so reads go through one narrow cast — the same pattern proposals.ts and
 * hydrateTransactionSplits already use for their untyped tables.
 */
function db(supabase: Awaited<ReturnType<typeof createClient>>) {
  return supabase as unknown as SupabaseClient;
}

const REPORT_SELECT = "id, number, name, notes, created_by, created_at, paid_at";

/**
 * A report line's charge. Deliberately NOT the review's TRANSACTION_SELECT:
 *  - no entity/category embed — a report is a W2 filing artifact, not a categorization surface;
 *  - `classifications` is a LEFT join (no !inner). TRANSACTION_SELECT's inner join was why the list
 *    and detail totals could disagree — an unclassified member counted in the list but was invisible
 *    on the page. Here it shows, with notes simply null.
 */
const REPORT_TXN_SELECT = `
  id,
  transaction_date,
  description,
  vendor,
  amount,
  expensed_at,
  expense_report_id,
  account:accounts!inner(display_name),
  classification:classifications(notes)
`;

const CAPTURE_SELECT = `
  id, captured_at, vendor, amount, note, capture_kind, match_status, matched_transaction_id,
  photo_path, photo_status, latitude, longitude, expensed_at, expense_report_id
`;

type RawTxn = {
  id: string;
  transaction_date: string;
  description: string;
  vendor: string | null;
  amount: number | string;
  expensed_at: string | null;
  expense_report_id: string;
  account: { display_name: string } | null;
  classification: { notes: string | null } | null;
};

type RawCapture = MemberCapture & { expense_report_id: string };

/**
 * COUNTED members only. Plaid-reversed and split parents are excluded here, once, so every consumer
 * (list total, detail total, CSV) agrees — and so the suppression rule in buildExpenseReportLines can
 * treat "is a member of this array" as "is a counted member of this report".
 *
 * Split parents are excluded because an all-or-nothing `expensed_at` on a parent would lie: every
 * other surface treats it as N legs.
 */
async function fetchMemberTransactions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  reportId?: string,
): Promise<Array<MemberTransaction & { expense_report_id: string }>> {
  const rows = await paginateAll<RawTxn>(
    async (from, size) => {
      let query = db(supabase)
        .from("transactions")
        .select(REPORT_TXN_SELECT)
        .is("plaid_removed_at", null)
        .is("split_at", null)
        .order("id")
        .range(from, from + size - 1);
      query = reportId
        ? query.eq("expense_report_id", reportId)
        : query.not("expense_report_id", "is", null);
      const { data, error } = await query;
      return { data: data as unknown as RawTxn[] | null, error };
    },
    1000,
    (row) => row.id,
  );

  return rows.map((row) => ({
    id: row.id,
    transaction_date: row.transaction_date,
    description: row.description,
    vendor: row.vendor,
    amount: Number(row.amount),
    account_name: row.account?.display_name ?? "Unknown account",
    notes: row.classification?.notes ?? null,
    expensed_at: row.expensed_at,
    expense_report_id: row.expense_report_id,
  }));
}

async function fetchMemberCaptures(
  supabase: Awaited<ReturnType<typeof createClient>>,
  reportId?: string,
): Promise<RawCapture[]> {
  return paginateAll<RawCapture>(
    async (from, size) => {
      let query = db(supabase)
        .from("expense_captures")
        .select(CAPTURE_SELECT)
        .order("id")
        .range(from, from + size - 1);
      query = reportId
        ? query.eq("expense_report_id", reportId)
        : query.not("expense_report_id", "is", null);
      const { data, error } = await query;
      return { data: data as unknown as RawCapture[] | null, error };
    },
    1000,
    (row) => row.id,
  );
}

function groupBy<T extends { expense_report_id: string }>(rows: T[]): Map<string, T[]> {
  const byReport = new Map<string, T[]>();
  for (const row of rows) {
    const list = byReport.get(row.expense_report_id);
    if (list) list.push(row);
    else byReport.set(row.expense_report_id, [row]);
  }
  return byReport;
}

/** All reports, newest first, each totalled through the SAME pure builder the detail page uses. */
export async function getExpenseReports(): Promise<ExpenseReportSummary[]> {
  const supabase = await createClient();

  const { data, error } = await db(supabase)
    .from("expense_reports")
    .select(REPORT_SELECT)
    .order("number", { ascending: false });
  if (error) throw error;

  const reports = (data ?? []) as unknown as ExpenseReportRow[];
  if (reports.length === 0) return [];

  // Two paginated scans for the whole list, then group in JS — never N queries per report.
  const [transactions, captures] = await Promise.all([
    fetchMemberTransactions(supabase),
    fetchMemberCaptures(supabase),
  ]);
  const txnsByReport = groupBy(transactions);
  const capturesByReport = groupBy(captures);

  return reports.map((report) => {
    const lines = buildExpenseReportLines(
      txnsByReport.get(report.id) ?? [],
      capturesByReport.get(report.id) ?? [],
    );
    return { ...report, ...sumExpenseReportLines(lines) };
  });
}

/** Money AC has bundled but not yet filed — the number he actually cares about. */
export function outstandingTotal(reports: ExpenseReportSummary[]): { total: number; count: number } {
  const unpaid = reports.filter((report) => !report.paid_at);
  return {
    total: unpaid.reduce((sum, report) => sum + report.total, 0),
    count: unpaid.length,
  };
}

export type ExpenseReportDetail = {
  report: ExpenseReportRow;
  lines: ExpenseReportLine[];
  totals: ExpenseReportTotals;
};

/** One report and its lines, addressed by the human-facing number (0001 -> 1). */
export async function getExpenseReportByNumber(
  reportNumber: number,
): Promise<ExpenseReportDetail | null> {
  const supabase = await createClient();

  const { data, error } = await db(supabase)
    .from("expense_reports")
    .select(REPORT_SELECT)
    .eq("number", reportNumber)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const report = data as unknown as ExpenseReportRow;
  const [transactions, captures] = await Promise.all([
    fetchMemberTransactions(supabase, report.id),
    fetchMemberCaptures(supabase, report.id),
  ]);

  const lines = buildExpenseReportLines(transactions, captures);
  return { report, lines, totals: sumExpenseReportLines(lines) };
}

/** Open (unpaid) reports, for the capture screen's target picker. */
export async function getOpenExpenseReports(): Promise<Pick<ExpenseReportRow, "id" | "number" | "name">[]> {
  const supabase = await createClient();
  const { data, error } = await db(supabase)
    .from("expense_reports")
    .select("id, number, name")
    .is("paid_at", null)
    .order("number", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as Pick<ExpenseReportRow, "id" | "number" | "name">[];
}
