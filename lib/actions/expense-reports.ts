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

function revalidateExpenseSurfaces() {
  revalidatePath("/transactions");
  revalidatePath("/expense-reports");
  // Dynamic route needs its own invalidation: "/expense-reports" does NOT match "/expense-reports/0001".
  revalidatePath("/expense-reports/[number]", "page");
  revalidatePath("/review");
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
  if (input.transactionIds.length === 0) return { error: "No transactions selected" };

  const admin = createServiceRoleClient();
  const actor = user?.email ?? user?.id ?? "unknown";

  const { data: report, error } = await admin
    .from("expense_reports")
    .insert({ name, created_by: actor })
    .select("id, number")
    .single();
  if (error) return { error: error.message };

  // Claim the rows. Service-role: `transactions` has no authenticated UPDATE policy (same reason the
  // split writer is service-role). A transaction already in another report is simply re-pointed here.
  for (const ids of chunk(input.transactionIds, 200)) {
    const { error: claimError } = await admin
      .from("transactions")
      .update({ expense_report_id: report.id })
      .in("id", ids);
    if (claimError) return { error: claimError.message };
  }

  if (input.assignJobW2) {
    const applied = await applyJobW2(admin, input.transactionIds, actor);
    if (applied.error) return { error: applied.error };
  }

  revalidateExpenseSurfaces();
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
  for (const ids of chunk(transactionIds, 200)) {
    const { error } = await admin
      .from("transactions")
      .update({ expense_report_id: null })
      .in("id", ids);
    if (error) return { error: error.message };
  }

  revalidateExpenseSurfaces();
  return { success: true, count: transactionIds.length };
}

/** Delete a report. Its transactions are released (FK is ON DELETE SET NULL), never deleted. */
export async function deleteExpenseReport(
  id: string,
): Promise<{ error: string } | { success: true }> {
  const { error: authError } = await requireUser();
  if (authError) return { error: authError };

  const admin = createServiceRoleClient();
  const { error } = await admin.from("expense_reports").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidateExpenseSurfaces();
  return { success: true };
}
