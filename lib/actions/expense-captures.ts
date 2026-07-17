"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isUuid } from "@/lib/uuid";

const BUCKET = "receipts";

const MAX_AMOUNT = 1_000_000;
const MAX_VENDOR_CHARS = 200;
const MAX_NOTE_CHARS = 2000;

/** With a concrete report number the one changed report page is busted instead of every report page. */
function revalidateCaptureSurfaces(reportNumber?: number) {
  revalidatePath("/capture");
  revalidatePath("/expense-reports");
  if (reportNumber !== undefined) {
    revalidatePath(`/expense-reports/${reportNumber}`);
  } else {
    revalidatePath("/expense-reports/[number]", "page");
  }
  revalidatePath("/transactions");
}

function validateCaptureAmount(amount: number): string | null {
  if (!Number.isFinite(amount) || amount <= 0) return "Amount must be greater than zero";
  if (amount > MAX_AMOUNT) return "Amount can't exceed 1,000,000";
  return null;
}

export type CreateExpenseCaptureInput = {
  expenseReportId: string | null;
  captureKind: "card" | "cash";
  vendor?: string | null;
  amount?: number | null;
  note?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  locationAccuracyM?: number | null;
  /** false when he saved without a photo at all. */
  withPhoto: boolean;
};

export type CreateExpenseCaptureResult =
  | { error: string }
  | { captureId: string; upload: { path: string; token: string } | null };

/**
 * Create the capture row and hand back a SIGNED UPLOAD URL for the photo.
 *
 * ROW FIRST, PHOTO SECOND — deliberately. The row is ~200 bytes and carries the entire reconcile
 * payload (vendor, amount, note, GPS, time); it gets through on a signal that can't move 800KB. So a
 * failed upload costs the corroborating image, never the capture. The failure this prevents is the
 * one the feature exists for: he shoots, gets distracted, walks out, the tab dies, everything is gone.
 *
 * WHY A SIGNED URL AND NOT AN UPLOAD THROUGH THIS ACTION: Server Actions cap request bodies at 1MB,
 * and Vercel's serverless request-body ceiling is 4.5MB and CANNOT be raised. A 3-12MB phone photo
 * hard-fails. This is the one place the repo's "writes go through a service-role action" convention
 * must yield to the platform: the server still decides (it mints the path + a single-use token), the
 * browser just executes, and the bytes go phone -> Storage without ever touching a Vercel function.
 */
export async function createExpenseCapture(
  input: CreateExpenseCaptureInput,
): Promise<CreateExpenseCaptureResult> {
  const { error: authError, user } = await requireUser();
  if (authError) return { error: authError };

  const vendor = input.vendor?.trim() || null;
  if (vendor && vendor.length > MAX_VENDOR_CHARS) {
    return { error: `Vendor is too long (${MAX_VENDOR_CHARS} characters max)` };
  }
  const note = input.note?.trim() || null;
  if (note && note.length > MAX_NOTE_CHARS) {
    return { error: `Note is too long (${MAX_NOTE_CHARS} characters max)` };
  }
  if (input.amount != null) {
    const amountError = validateCaptureAmount(input.amount);
    if (amountError) return { error: amountError };
  }

  const admin = createServiceRoleClient();
  const actor = user?.email ?? user?.id ?? "unknown";

  // Same guard addToExpenseReport has: a paid report was already filed and reimbursed, so quietly
  // growing it desyncs AC from what Cursor actually paid. The client's picker only lists open reports,
  // but a stale tab is exactly how a since-paid id gets posted — the check belongs on the server.
  let reportNumber: number | undefined;
  if (input.expenseReportId) {
    const { data: report, error: reportError } = await admin
      .from("expense_reports")
      .select("number, paid_at")
      .eq("id", input.expenseReportId)
      .maybeSingle();
    if (reportError) return { error: reportError.message };
    if (!report) return { error: "That expense report no longer exists" };
    if (report.paid_at) return { error: "That report is already marked paid. Start a new one." };
    reportNumber = report.number as number;
  }

  const { data: capture, error } = await admin
    .from("expense_captures")
    .insert({
      expense_report_id: input.expenseReportId,
      capture_kind: input.captureKind,
      // A cash capture is terminal: there is no charge coming, so it never enters the match queue.
      match_status: input.captureKind === "cash" ? "cash" : "unmatched",
      vendor,
      amount: input.amount ?? null,
      note,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      location_accuracy_m: input.locationAccuracyM ?? null,
      photo_status: input.withPhoto ? "pending" : "none",
      created_by: actor,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  const captureId = capture.id as string;
  if (!input.withPhoto) {
    revalidateCaptureSurfaces(reportNumber);
    return { captureId, upload: null };
  }

  // {user}/{YYYY-MM}/{capture_id}.jpg — the id as the filename means no collisions and no
  // user-controlled string in the path; the month prefix keeps the bucket browsable later.
  const month = new Date().toISOString().slice(0, 7);
  const path = `${user?.id ?? "unknown"}/${month}/${captureId}.jpg`;

  const { data: signed, error: signError } = await admin.storage
    .from(BUCKET)
    .createSignedUploadUrl(path);
  if (signError) {
    // The row survives; he can re-attach the photo from the list later.
    await admin.from("expense_captures").update({ photo_status: "failed" }).eq("id", captureId);
    revalidateCaptureSurfaces(reportNumber);
    return { captureId, upload: null };
  }

  await admin.from("expense_captures").update({ photo_path: path }).eq("id", captureId);
  revalidateCaptureSurfaces(reportNumber);
  return { captureId, upload: { path, token: signed.token } };
}

/** Enrichment after the row already exists (amount/vendor/note typed at leisure). */
export async function updateExpenseCapture(input: {
  id: string;
  vendor?: string | null;
  amount?: number | null;
  note?: string | null;
  captureKind?: "card" | "cash";
  expenseReportId?: string | null;
}): Promise<{ error: string } | { success: true }> {
  const { error: authError } = await requireUser();
  if (authError) return { error: authError };

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.vendor !== undefined) {
    const vendor = input.vendor?.trim() || null;
    if (vendor && vendor.length > MAX_VENDOR_CHARS) {
      return { error: `Vendor is too long (${MAX_VENDOR_CHARS} characters max)` };
    }
    patch.vendor = vendor;
  }
  if (input.amount !== undefined) {
    if (input.amount != null) {
      const amountError = validateCaptureAmount(input.amount);
      if (amountError) return { error: amountError };
    }
    patch.amount = input.amount;
  }
  if (input.note !== undefined) {
    const note = input.note?.trim() || null;
    if (note && note.length > MAX_NOTE_CHARS) {
      return { error: `Note is too long (${MAX_NOTE_CHARS} characters max)` };
    }
    patch.note = note;
  }
  if (input.captureKind !== undefined) {
    patch.capture_kind = input.captureKind;
    patch.match_status = input.captureKind === "cash" ? "cash" : "unmatched";
    // Flipping to cash means "no charge is coming" — drop any pending match.
    if (input.captureKind === "cash") {
      patch.matched_transaction_id = null;
      patch.matched_at = null;
    }
  }
  if (input.expenseReportId !== undefined) {
    patch.expense_report_id = input.expenseReportId;
    patch.expensed_at = null; // report-scoped state must not survive a move
  }

  const admin = createServiceRoleClient();
  const { error } = await admin.from("expense_captures").update(patch).eq("id", input.id);
  if (error) return { error: error.message };

  revalidateCaptureSurfaces();
  return { success: true };
}

export async function markCapturePhotoStatus(input: {
  id: string;
  status: "uploaded" | "failed";
}): Promise<{ error: string } | { success: true }> {
  const { error: authError } = await requireUser();
  if (authError) return { error: authError };

  const admin = createServiceRoleClient();
  const { error } = await admin
    .from("expense_captures")
    .update({ photo_status: input.status, updated_at: new Date().toISOString() })
    .eq("id", input.id);
  if (error) return { error: error.message };

  // Photo status renders on /capture and the report surfaces; /transactions never shows it.
  revalidatePath("/capture");
  revalidatePath("/expense-reports");
  revalidatePath("/expense-reports/[number]", "page");
  return { success: true };
}

/** Re-mint an upload URL for a capture whose photo failed (or was never attached). */
export async function createCapturePhotoUpload(
  captureId: string,
): Promise<{ error: string } | { path: string; token: string }> {
  const { error: authError, user } = await requireUser();
  if (authError) return { error: authError };

  // The id is interpolated into a storage object path — a non-UUID ("../...") could escape the
  // user/month prefix, so gate on format AND on the row actually existing before minting a URL.
  if (!isUuid(captureId)) return { error: "Invalid capture id" };

  const admin = createServiceRoleClient();

  const { data: existing, error: existingError } = await admin
    .from("expense_captures")
    .select("id")
    .eq("id", captureId)
    .maybeSingle();
  if (existingError) return { error: existingError.message };
  if (!existing) return { error: "That capture no longer exists" };

  const month = new Date().toISOString().slice(0, 7);
  const path = `${user?.id ?? "unknown"}/${month}/${captureId}.jpg`;

  // upsert stays true: the re-shoot/replace-photo path overwrites the same object on purpose.
  const { data: signed, error } = await admin.storage
    .from(BUCKET)
    .createSignedUploadUrl(path, { upsert: true });
  if (error) return { error: error.message };

  await admin
    .from("expense_captures")
    .update({ photo_path: path, photo_status: "pending" })
    .eq("id", captureId);
  return { path, token: signed.token };
}

/**
 * Match a capture to the charge that settled it. Goes through the RPC because match + co-membership
 * + clearing the stale flag is one money invariant — a half-applied match makes the report file short.
 */
export async function reconcileCapture(input: {
  captureId: string;
  transactionId: string;
}): Promise<{ error: string } | { success: true }> {
  const { error: authError } = await requireUser();
  if (authError) return { error: authError };

  const admin = createServiceRoleClient();
  const { error } = await admin.rpc("reconcile_capture", {
    p_capture_id: input.captureId,
    p_transaction_id: input.transactionId,
  });
  if (error) return { error: error.message };

  revalidateCaptureSurfaces();
  return { success: true };
}

export async function unreconcileCapture(
  captureId: string,
): Promise<{ error: string } | { success: true }> {
  const { error: authError } = await requireUser();
  if (authError) return { error: authError };

  const admin = createServiceRoleClient();
  const { error } = await admin.rpc("unreconcile_capture", { p_capture_id: captureId });
  if (error) return { error: error.message };

  revalidateCaptureSurfaces();
  return { success: true };
}

/** Terminal: this was cash, no charge is ever coming. Gets it out of the match queue for good. */
export async function markCaptureAsCash(
  captureId: string,
): Promise<{ error: string } | { success: true }> {
  return updateExpenseCapture({ id: captureId, captureKind: "cash" });
}

/** Delete a capture AND its photo — there's no FK to storage, so an orphaned object leaks forever. */
export async function deleteExpenseCapture(
  captureId: string,
): Promise<{ error: string } | { success: true }> {
  const { error: authError } = await requireUser();
  if (authError) return { error: authError };

  const admin = createServiceRoleClient();

  const { data: capture } = await admin
    .from("expense_captures")
    .select("photo_path")
    .eq("id", captureId)
    .maybeSingle();

  const { error } = await admin.from("expense_captures").delete().eq("id", captureId);
  if (error) return { error: error.message };

  if (capture?.photo_path) {
    // Best-effort: the row is already gone, and a stale object is a leak, not a correctness bug.
    await admin.storage.from(BUCKET).remove([capture.photo_path as string]);
  }

  revalidateCaptureSurfaces();
  return { success: true };
}
