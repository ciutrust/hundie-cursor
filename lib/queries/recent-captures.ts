import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * `expense_captures` isn't in the generated Database type yet, so reads go through one narrow
 * cast - the same pattern expense-captures.ts and stale-captures.ts use.
 */
function db(supabase: Awaited<ReturnType<typeof createClient>>) {
  return supabase as unknown as SupabaseClient;
}

export type RecentCaptureRow = {
  id: string;
  vendor: string | null;
  amount: number | null;
  captured_at: string;
  capture_kind: "card" | "cash";
  match_status: string;
  photo_path: string | null;
  photo_status: string;
  expense_report_id: string | null;
  expense_report: { number: number; name: string } | null;
};

/**
 * The last few captures, newest first - the "did that actually save?" glance after a shot.
 * All statuses on purpose: a capture whose photo never uploaded is exactly the one worth
 * surfacing here, because this screen is the only place he'd notice in the moment.
 */
export async function getRecentCaptures(limit = 5): Promise<RecentCaptureRow[]> {
  const supabase = await createClient();

  const { data, error } = await db(supabase)
    .from("expense_captures")
    .select(
      "id, vendor, amount, captured_at, capture_kind, match_status, photo_path, photo_status, expense_report_id, expense_report:expense_reports(number, name)",
    )
    .order("captured_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  return (data ?? []) as unknown as RecentCaptureRow[];
}
