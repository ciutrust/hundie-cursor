import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * A card charge normally settles within 0-5 days of the receipt. Past a week the capture is
 * either forgotten or the charge never posted - both worth a nudge before a report double-counts.
 */
const STALE_AFTER_DAYS = 7;

/**
 * `expense_captures` isn't in the generated Database type yet, so reads go through one narrow
 * cast - the same pattern expense-reports.ts and expense-captures.ts use.
 */
function db(supabase: Awaited<ReturnType<typeof createClient>>) {
  return supabase as unknown as SupabaseClient;
}

export type StaleCaptureRow = {
  id: string;
  vendor: string | null;
  amount: number | null;
  captured_at: string;
  expense_report_id: string | null;
  expense_report: { number: number; name: string; paid_at: string | null } | null;
};

/**
 * Card captures still unmatched after STALE_AFTER_DAYS, oldest first (the longest-waiting one is
 * the most likely to be a problem). Cash is terminal and never stale. Served by the partial index
 * on (captured_at desc) where match_status = 'unmatched'.
 *
 * Captures inside a PAID report are excluded: that money was already filed and reimbursed, so
 * "still waiting" is noise - and the reconcile deep link would rewrite a filed report's total.
 *
 * Never throws: the banner is decoration on the money list page, and a nudge failing must not
 * take the reports list down with it.
 */
export async function getStaleCaptures(): Promise<StaleCaptureRow[]> {
  try {
    const supabase = await createClient();
    const cutoff = new Date(Date.now() - STALE_AFTER_DAYS * 864e5).toISOString();

    const { data, error } = await db(supabase)
      .from("expense_captures")
      .select(
        "id, vendor, amount, captured_at, expense_report_id, expense_report:expense_reports(number, name, paid_at)",
      )
      .eq("match_status", "unmatched")
      .eq("capture_kind", "card")
      .lt("captured_at", cutoff)
      .order("captured_at", { ascending: true });
    if (error) throw error;

    const rows = (data ?? []) as unknown as StaleCaptureRow[];
    return rows.filter((row) => row.expense_report?.paid_at == null);
  } catch (error) {
    console.error("getStaleCaptures failed:", error);
    return [];
  }
}
