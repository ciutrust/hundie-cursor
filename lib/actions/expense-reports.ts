"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import { chunk } from "@/lib/supabase/chunk";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * The reimbursed-W2 travel wash: a job trip is charged to a card, the employer reimburses it, so it
 * nets to zero and is neither a business deduction nor personal spend. Resolved SERVER-SIDE by slug +
 * path — never trusted from the client, so a tampered payload can't book charges into another category.
 */
const JOB_W2_ENTITY_SLUG = "personal";
const JOB_W2_CATEGORY_PATH = "Job W2 Expenses";

type Admin = ReturnType<typeof createServiceRoleClient>;

export type CreateExpenseReportInput = {
  name: string;
  transactionIds: string[];
  assignJobW2: boolean;
};

async function resolveJobW2(
  admin: Admin,
): Promise<{ entityId: string; categoryId: string } | { error: string }> {
  const { data: entity, error: entityError } = await admin
    .from("entities")
    .select("id")
    .eq("slug", JOB_W2_ENTITY_SLUG)
    .maybeSingle();
  if (entityError) return { error: entityError.message };
  if (!entity) return { error: `Entity "${JOB_W2_ENTITY_SLUG}" not found` };

  const { data: category, error: categoryError } = await admin
    .from("categories")
    .select("id")
    .eq("entity_id", entity.id)
    .eq("full_path", JOB_W2_CATEGORY_PATH)
    .maybeSingle();
  if (categoryError) return { error: categoryError.message };
  if (!category) {
    return { error: `Category "${JOB_W2_CATEGORY_PATH}" not found on ${JOB_W2_ENTITY_SLUG}` };
  }

  return { entityId: entity.id as string, categoryId: category.id as string };
}

/** Book the given transactions to Personal / Job W2 Expenses. Chunked: `.in()` rides the PATCH URL. */
async function applyJobW2(
  admin: Admin,
  transactionIds: string[],
  actor: string,
): Promise<{ error: string | null }> {
  const resolved = await resolveJobW2(admin);
  if ("error" in resolved) return { error: resolved.error };

  const classifiedAt = new Date().toISOString();
  for (const ids of chunk(transactionIds, 200)) {
    const { error } = await admin
      .from("classifications")
      .update({
        entity_id: resolved.entityId,
        category_id: resolved.categoryId,
        classified_by: actor,
        classified_at: classifiedAt,
      })
      .in("transaction_id", ids);
    if (error) return { error: error.message };
  }
  return { error: null };
}

/**
 * Point transactions at a report (or null to release them).
 *
 * Service-role: `transactions` has no authenticated UPDATE policy (same reason the split writer is).
 * `expensed_at` is ALWAYS cleared in the same write — it is report-scoped state living on a bank-truth
 * row, so a line re-added to another report would otherwise arrive already ticked green.
 */
async function claimTransactions(
  admin: Admin,
  reportId: string | null,
  transactionIds: string[],
): Promise<string | null> {
  for (const ids of chunk(transactionIds, 200)) {
    // Detach any capture matched to a charge that is moving somewhere its capture ISN'T. Leaving the
    // match would strand the pair (capture in report A, charge in B) — the capture suppresses in
    // NEITHER report under the same-report rule, so its money silently vanishes from both. This is the
    // state reconcile_capture's own guard refuses to create; don't let the back door create it either.
    const { data: matched, error: matchedError } = await admin
      .from("expense_captures")
      .select("id, expense_report_id")
      .in("matched_transaction_id", ids);
    if (matchedError) return matchedError.message;

    const stranded = ((matched ?? []) as Array<{ id: string; expense_report_id: string | null }>)
      .filter((capture) => capture.expense_report_id !== reportId)
      .map((capture) => capture.id);

    if (stranded.length > 0) {
      const { error } = await admin
        .from("expense_captures")
        .update({
          matched_transaction_id: null,
          match_status: "unmatched",
          matched_at: null,
          updated_at: new Date().toISOString(),
        })
        .in("id", stranded);
      if (error) return error.message;
    }

    const { error } = await admin
      .from("transactions")
      .update({ expense_report_id: reportId, expensed_at: null })
      .in("id", ids);
    if (error) return error.message;
  }
  return null;
}

/** With a concrete report number the one changed report page is busted instead of every report page. */
function revalidateExpenseSurfaces(reportNumber?: number) {
  revalidatePath("/transactions");
  revalidatePath("/expense-reports");
  // Dynamic route needs its own invalidation: "/expense-reports" does NOT match "/expense-reports/17".
  if (reportNumber !== undefined) {
    revalidatePath(`/expense-reports/${reportNumber}`);
  } else {
    revalidatePath("/expense-reports/[number]", "page");
  }
}

/** One-click: book a selection as the reimbursed-W2 wash, without creating a report. */
export async function assignJobW2Expenses(
  transactionIds: string[],
): Promise<{ error: string } | { success: true; count: number }> {
  const { error: authError, user } = await requireUser();
  if (authError) return { error: authError };
  if (transactionIds.length === 0) return { error: "No transactions selected" };

  const admin = createServiceRoleClient();
  const actor = user?.email ?? user?.id ?? "unknown";

  const applied = await applyJobW2(admin, transactionIds, actor);
  if (applied.error) return { error: applied.error };

  revalidateExpenseSurfaces();
  // The W2 wash rewrites classifications, and /review's progress numbers count those.
  revalidatePath("/review");
  return { success: true, count: transactionIds.length };
}

/**
 * Create a numbered report from a selection. `number` is a DB identity column, so concurrent creates
 * can't collide on 0001. Optionally books the same transactions as the W2 wash in the one action.
 */
export async function createExpenseReport(
  input: CreateExpenseReportInput,
): Promise<{ error: string } | { id: string; number: number }> {
  const { error: authError, user } = await requireUser();
  if (authError) return { error: authError };

  const name = input.name.trim();
  if (!name) return { error: "Give the report a name" };
  // An EMPTY report is legitimate and is the capture screen's whole flow: he starts "Workidate
  // Sacramento" at the airport and snaps receipts into it for days before a single charge posts.
  // (chunk([]) yields nothing, so claimTransactions no-ops, and applyJobW2 is gated on the flag.)

  const admin = createServiceRoleClient();
  const actor = user?.email ?? user?.id ?? "unknown";

  const { data: report, error } = await admin
    .from("expense_reports")
    .insert({ name, created_by: actor })
    .select("id, number")
    .single();
  if (error) return { error: error.message };

  const claimError = await claimTransactions(admin, report.id, input.transactionIds);
  if (claimError) return { error: claimError };

  if (input.assignJobW2) {
    const applied = await applyJobW2(admin, input.transactionIds, actor);
    if (applied.error) return { error: applied.error };
    // The W2 wash rewrites classifications, and /review's progress numbers count those.
    revalidatePath("/review");
  }

  revalidateExpenseSurfaces(report.number as number);
  return { id: report.id as string, number: report.number as number };
}

/** Drop lines out of a report; the transactions themselves are untouched (they just lose the tag). */
export async function removeFromExpenseReport(
  transactionIds: string[],
): Promise<{ error: string } | { success: true; count: number }> {
  const { error: authError } = await requireUser();
  if (authError) return { error: authError };
  if (transactionIds.length === 0) return { error: "No lines selected" };

  const admin = createServiceRoleClient();
  const claimError = await claimTransactions(admin, null, transactionIds);
  if (claimError) return { error: claimError };

  revalidateExpenseSurfaces();
  return { success: true, count: transactionIds.length };
}

/**
 * Add charges to an EXISTING report — how a card charge joins the capture that's been waiting for it.
 *
 * Deliberately does NOT reconcile: the caller surfaces the "looks like these are the same spend?"
 * prompt. Adding a charge next to its unreconciled capture is the default double-count path, so the
 * UI must offer the match here rather than leaving both lines standing.
 */
export async function addToExpenseReport(input: {
  reportId: string;
  transactionIds: string[];
}): Promise<{ error: string } | { success: true; count: number }> {
  const { error: authError } = await requireUser();
  if (authError) return { error: authError };
  if (input.transactionIds.length === 0) return { error: "No transactions selected" };

  const admin = createServiceRoleClient();

  const { data: report, error } = await admin
    .from("expense_reports")
    .select("id, number, paid_at")
    .eq("id", input.reportId)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!report) return { error: "That expense report no longer exists" };
  // A paid report has already been filed and reimbursed; quietly growing it would desync AC from
  // what Cursor actually paid.
  if (report.paid_at) return { error: "That report is already marked paid. Start a new one." };

  const claimError = await claimTransactions(admin, input.reportId, input.transactionIds);
  if (claimError) return { error: claimError };

  revalidateExpenseSurfaces(report.number as number);
  return { success: true, count: input.transactionIds.length };
}

/** The per-line Expensed toggle (green/red). Charges and captures live in different tables. */
export async function setLineExpensed(input: {
  kind: "transaction" | "capture";
  id: string;
  expensed: boolean;
}): Promise<{ error: string } | { success: true }> {
  const { error: authError } = await requireUser();
  if (authError) return { error: authError };

  const admin = createServiceRoleClient();
  const table = input.kind === "transaction" ? "transactions" : "expense_captures";
  const patch: Record<string, unknown> = { expensed_at: input.expensed ? new Date().toISOString() : null };
  if (input.kind === "capture") patch.updated_at = new Date().toISOString();

  const { error } = await admin.from(table).update(patch).eq("id", input.id);
  if (error) return { error: error.message };

  // The expensed tick is report-page state: /transactions renders neither expensed_at nor report
  // membership, and the toggle can't change the open-reports list, so skip that path.
  revalidatePath("/expense-reports");
  revalidatePath("/expense-reports/[number]", "page");
  return { success: true };
}

/** The report's PAID (green) / UNPAID (amber) status — did the reimbursement actually land. */
export async function setExpenseReportPaid(input: {
  id: string;
  paid: boolean;
}): Promise<{ error: string } | { success: true }> {
  const { error: authError } = await requireUser();
  if (authError) return { error: authError };

  const admin = createServiceRoleClient();
  // /transactions stays in the fan-out: its open-reports list is filtered on paid_at, so this toggle
  // changes what the "Add to existing report" picker offers. The .select() rides the same round trip
  // purely to name the one report page that changed.
  const { data: report, error } = await admin
    .from("expense_reports")
    .update({ paid_at: input.paid ? new Date().toISOString() : null })
    .eq("id", input.id)
    .select("number")
    .maybeSingle();
  if (error) return { error: error.message };

  revalidateExpenseSurfaces(report ? (report.number as number) : undefined);
  return { success: true };
}

/**
 * Delete a report. Charges are released (FK is ON DELETE SET NULL) and stay in the ledger.
 *
 * Its CAPTURES are deleted with it, photos and all. The FK would merely null their report out, but an
 * unfiled capture has no screen anywhere (the reconcile queue is card-only; report views require a
 * report id), so "released" captures are a black hole — and a cash capture is the ONLY record of that
 * money. Orphaning them would be a silent loss AND leak their storage objects forever. Deleting them
 * deliberately, with the count surfaced so the UI can say so, is the honest behavior.
 */
export async function deleteExpenseReport(
  id: string,
): Promise<{ error: string } | { success: true; deletedCaptures: number }> {
  const { error: authError } = await requireUser();
  if (authError) return { error: authError };

  const admin = createServiceRoleClient();

  const { data: captures, error: captureError } = await admin
    .from("expense_captures")
    .select("id, photo_path")
    .eq("expense_report_id", id);
  if (captureError) return { error: captureError.message };

  const rows = (captures ?? []) as Array<{ id: string; photo_path: string | null }>;
  const paths = rows.map((row) => row.photo_path).filter((path): path is string => Boolean(path));

  if (rows.length > 0) {
    const { error } = await admin
      .from("expense_captures")
      .delete()
      .in("id", rows.map((row) => row.id));
    if (error) return { error: error.message };
  }

  const { error } = await admin.from("expense_reports").delete().eq("id", id);
  if (error) return { error: error.message };

  // Best-effort, after the rows are gone: a stray object is a leak, not a correctness bug.
  if (paths.length > 0) await admin.storage.from("receipts").remove(paths);

  revalidateExpenseSurfaces();
  return { success: true, deletedCaptures: rows.length };
}
