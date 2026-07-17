import type { SupabaseClient } from "@supabase/supabase-js";
import {
  confidentCaptureMatch,
  rankCaptureMatches,
  MAX_DAYS_AFTER,
  MAX_TIP_RATIO,
  type CaptureMatchScore,
  type ChargeLike,
} from "@/lib/receipts/match";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const BUCKET = "receipts";

function db(supabase: Awaited<ReturnType<typeof createClient>>) {
  return supabase as unknown as SupabaseClient;
}

/**
 * Sign a batch of photo paths in ONE round trip.
 *
 * The bucket is private, so the browser can never fetch a photo directly — a server component resolves
 * paths to short-lived signed URLs and passes plain strings down. The service-role client never
 * crosses into the browser. Signed URLs expire (1h): these pages are dynamic/auth'd anyway, and a page
 * left open past the TTL just needs a refresh.
 */
export async function signCapturePhotoUrls(paths: string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(paths.filter(Boolean))];
  const urls = new Map<string, string>();
  if (wanted.length === 0) return urls;

  const admin = createServiceRoleClient();
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrls(wanted, 3600);
  // A photo that won't sign is a missing thumbnail, not a broken page — the row's data still stands.
  if (error || !data) return urls;

  for (const row of data) {
    if (row.signedUrl && row.path) urls.set(row.path, row.signedUrl);
  }
  return urls;
}

export type CaptureRow = {
  id: string;
  captured_at: string;
  vendor: string | null;
  amount: number | null;
  note: string | null;
  capture_kind: "card" | "cash";
  match_status: string;
  matched_transaction_id: string | null;
  photo_path: string | null;
  photo_status: string;
  latitude: number | null;
  longitude: number | null;
  expense_report_id: string | null;
};

const CAPTURE_SELECT = `
  id, captured_at, vendor, amount, note, capture_kind, match_status, matched_transaction_id,
  photo_path, photo_status, latitude, longitude, expense_report_id
`;

/** Card captures still waiting on their charge — the reconcile queue. Cash is terminal and excluded. */
export async function getUnmatchedCaptures(): Promise<CaptureRow[]> {
  const supabase = await createClient();
  const { data, error } = await db(supabase)
    .from("expense_captures")
    .select(CAPTURE_SELECT)
    .eq("match_status", "unmatched")
    .eq("capture_kind", "card")
    .order("captured_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as CaptureRow[];
}

export type CaptureMatchSuggestion = {
  capture: CaptureRow;
  candidates: Array<CaptureMatchScore & { charge: ChargeLike }>;
  /** Set only when one candidate clearly wins; null means "make him pick". */
  confident: (CaptureMatchScore & { charge: ChargeLike }) | null;
};

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Transaction ids already backing SOME capture. Charges in this set are excluded from suggestions —
 * without that, one charge gets suggested for several captures (the bug bills had to work around at
 * runtime). Fetched separately from the scoring so a batch caller pays for this scan once, not per
 * capture. `excludeCaptureId` keeps a capture's own current match out of its own taken set.
 */
export async function getTakenMatchedTransactionIds(excludeCaptureId?: string): Promise<Set<string>> {
  const supabase = await createClient();
  let query = db(supabase)
    .from("expense_captures")
    .select("matched_transaction_id")
    .not("matched_transaction_id", "is", null);
  if (excludeCaptureId) query = query.neq("id", excludeCaptureId);
  const { data: takenData } = await query;
  return new Set(
    ((takenData ?? []) as unknown as Array<{ matched_transaction_id: string }>).map(
      (row) => row.matched_transaction_id,
    ),
  );
}

/**
 * Rank the charges that might have settled this capture — the row + taken-set core.
 *
 * Pre-filters in SQL to what the matcher could possibly accept (a charge posts ON/AFTER the receipt,
 * within MAX_DAYS_AFTER, and at most MAX_TIP_RATIO above it), then applies the real scoring in
 * lib/receipts/match.ts. Takes the capture ROW and a pre-fetched taken set so getCaptureMatchPrompts
 * can score a whole report's waiting captures off one taken-scan; the per-capture charge query is
 * inherent (each capture has its own date window).
 */
export async function buildCaptureMatchSuggestion(
  capture: CaptureRow,
  takenTransactionIds: Set<string>,
): Promise<CaptureMatchSuggestion> {
  // Nothing to match: cash is terminal, and with no amount the matcher has no anchor.
  if (capture.capture_kind === "cash" || capture.amount == null) {
    return { capture, candidates: [], confident: null };
  }

  const supabase = await createClient();
  const day = capture.captured_at.slice(0, 10);
  const { data: chargeData, error: chargeError } = await db(supabase)
    .from("transactions")
    .select("id, vendor, description, amount, transaction_date")
    .is("plaid_removed_at", null)
    .is("split_at", null)
    .gte("transaction_date", day)
    .lte("transaction_date", addDays(day, MAX_DAYS_AFTER))
    .gt("amount", 0)
    // Mirror the scorer's band exactly. `.gte(capture.amount)` would silently negate its
    // UNDER_TOLERANCE, so a charge a cent under the receipt (rounding) would never even be a candidate.
    .gte("amount", capture.amount - 0.02)
    .lte("amount", capture.amount * (1 + MAX_TIP_RATIO) + 0.01)
    .order("transaction_date", { ascending: true });
  if (chargeError) throw chargeError;

  const charges = (chargeData ?? []) as unknown as ChargeLike[];

  const ranked = rankCaptureMatches(
    { vendor: capture.vendor, amount: capture.amount, captured_at: capture.captured_at },
    charges,
    { excludeTransactionIds: takenTransactionIds },
  );

  const byId = new Map(charges.map((charge) => [charge.id, charge]));
  const candidates = ranked.map((score) => ({ ...score, charge: byId.get(score.transactionId)! }));
  const top = confidentCaptureMatch(ranked);

  return {
    capture,
    candidates,
    confident: top ? candidates.find((c) => c.transactionId === top.transactionId) ?? null : null,
  };
}

/** The one-capture entry point: fetch the row + its taken set, then score. Signature unchanged. */
export async function getCaptureMatchSuggestion(
  captureId: string,
): Promise<CaptureMatchSuggestion | null> {
  const supabase = await createClient();

  const { data: captureData, error } = await db(supabase)
    .from("expense_captures")
    .select(CAPTURE_SELECT)
    .eq("id", captureId)
    .maybeSingle();
  if (error) throw error;
  if (!captureData) return null;

  const capture = captureData as unknown as CaptureRow;
  // Early out before the taken-scan: cash/amountless captures never needed it.
  if (capture.capture_kind === "cash" || capture.amount == null) {
    return { capture, candidates: [], confident: null };
  }

  const taken = await getTakenMatchedTransactionIds(captureId);
  return buildCaptureMatchSuggestion(capture, taken);
}
