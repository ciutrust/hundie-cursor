"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/auth/require-user";
import { chunk } from "@/lib/supabase/chunk";
import type { Cadence } from "@/lib/bills/cadence";
import { computeNextInstance, type BillDef } from "@/lib/bills/instances";
import type { BillStatus } from "@/lib/bills/types";

// bills / bill_instances are accessed through an untyped client view (not in the generated DB types).
// No service-role client is needed: both tables grant authenticated insert/update, and confirming a
// payment only writes bill_instances — never the ledger (transactions / classifications).

type ActionResult = { success: true } | { error: string };

export type CreateBillInput = {
  entityId: string;
  name: string;
  expectedAmount: number | null;
  amountVaries: boolean;
  cadence: Cadence;
  dueDay: number | null;
  anchorDate: string | null;
  portalUrl: string | null;
  loginHint: string | null;
  matchHint: string | null;
  categoryId: string | null;
  notes: string | null;
};

const GENERATABLE_SELECT = "id, entity_id, cadence, due_day, anchor_date, expected_amount, status";

/** A category (when set) must belong to the bill's entity — mirrors reclassifyTransaction's guard. */
async function assertCategoryInEntity(
  db: SupabaseClient,
  categoryId: string | null,
  entityId: string,
): Promise<string | null> {
  if (!categoryId) return null;
  const { data: category, error } = await db
    .from("categories")
    .select("entity_id")
    .eq("id", categoryId)
    .maybeSingle();
  if (error) return error.message;
  if (!category || (category as { entity_id: string }).entity_id !== entityId) {
    return "Category does not belong to the selected entity";
  }
  return null;
}

function billColumns(input: CreateBillInput): Record<string, unknown> {
  return {
    entity_id: input.entityId,
    name: input.name.trim(),
    expected_amount: input.expectedAmount,
    amount_varies: input.amountVaries,
    cadence: input.cadence,
    due_day: input.dueDay,
    anchor_date: input.anchorDate,
    portal_url: input.portalUrl?.trim() || null,
    login_hint: input.loginHint?.trim() || null,
    match_hint: input.matchHint?.trim() || null,
    category_id: input.categoryId,
    notes: input.notes?.trim() || null,
  };
}

export async function createBill(
  input: CreateBillInput,
): Promise<{ success: true; id: string } | { error: string }> {
  const { error: authError, supabase } = await requireUser();
  if (authError) return { error: authError };
  const db = supabase as unknown as SupabaseClient;

  if (!input.name.trim()) return { error: "Bill name is required" };
  const categoryError = await assertCategoryInEntity(db, input.categoryId, input.entityId);
  if (categoryError) return { error: categoryError };

  const { data, error } = await db
    .from("bills")
    .insert(billColumns(input))
    .select("id")
    .single();
  if (error) return { error: error.message };

  revalidatePath("/bills");
  return { success: true, id: (data as { id: string }).id };
}

export async function updateBill(
  id: string,
  input: CreateBillInput,
): Promise<ActionResult> {
  const { error: authError, supabase } = await requireUser();
  if (authError) return { error: authError };
  const db = supabase as unknown as SupabaseClient;

  if (!input.name.trim()) return { error: "Bill name is required" };
  const categoryError = await assertCategoryInEntity(db, input.categoryId, input.entityId);
  if (categoryError) return { error: categoryError };

  const { error } = await db
    .from("bills")
    .update({ ...billColumns(input), updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };

  // A bill can be re-assigned to another entity (the edit form allows it). bill_instances carry a
  // denormalized entity_id that the dashboard/suggestion reads rely on, so keep it in sync — otherwise
  // an open instance keeps the OLD entity and gets matched against the wrong entity's ledger.
  const { error: syncError } = await db
    .from("bill_instances")
    .update({ entity_id: input.entityId, updated_at: new Date().toISOString() })
    .eq("bill_id", id);
  if (syncError) return { error: syncError.message };

  revalidatePath("/bills");
  return { success: true };
}

export async function setBillStatus(id: string, status: BillStatus): Promise<ActionResult> {
  const { error: authError, supabase } = await requireUser();
  if (authError) return { error: authError };
  const db = supabase as unknown as SupabaseClient;

  const { error } = await db
    .from("bills")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/bills");
  return { success: true };
}

export async function archiveBill(id: string): Promise<ActionResult> {
  return setBillStatus(id, "archived");
}

/** Advance a bill by ensuring the cycle after `paidDueDate` exists (idempotent via the unique key). */
async function ensureNextCycle(db: SupabaseClient, billId: string, paidDueDate: string): Promise<void> {
  const { data: billRow } = await db
    .from("bills")
    .select(GENERATABLE_SELECT)
    .eq("id", billId)
    .maybeSingle();
  if (!billRow) return;
  const bill = billRow as BillDef;
  const next = computeNextInstance(bill, paidDueDate);
  if (!next) return;
  await db
    .from("bill_instances")
    .upsert({ ...next, status: "open" as const }, {
      onConflict: "bill_id,due_date",
      ignoreDuplicates: true,
    });
}

async function markInstancePaid(
  db: SupabaseClient,
  instanceId: string,
  patch: { matched_transaction_id: string | null; paid_amount: number | null; paid_at: string },
): Promise<{ bill_id: string; due_date: string } | { error: string }> {
  // Guard on status='open' so a payment is never confirmed twice (a resolved instance won't match).
  const { data, error } = await db
    .from("bill_instances")
    .update({ status: "paid", ...patch, updated_at: new Date().toISOString() })
    .eq("id", instanceId)
    .eq("status", "open")
    .select("bill_id, due_date");
  if (error) return { error: error.message };
  const rows = (data ?? []) as { bill_id: string; due_date: string }[];
  if (rows.length === 0) return { error: "This bill cycle is not open (already resolved)" };
  return rows[0];
}

export async function confirmBillPayment(input: {
  instanceId: string;
  transactionId: string;
  paidAmount?: number | null;
  paidAt?: string | null;
}): Promise<ActionResult> {
  const { error: authError, supabase } = await requireUser();
  if (authError) return { error: authError };
  const db = supabase as unknown as SupabaseClient;

  const result = await markInstancePaid(db, input.instanceId, {
    matched_transaction_id: input.transactionId,
    paid_amount: input.paidAmount ?? null,
    paid_at: input.paidAt ?? new Date().toISOString(),
  });
  if ("error" in result) return { error: result.error };

  await ensureNextCycle(db, result.bill_id, result.due_date);
  revalidatePath("/bills");
  return { success: true };
}

export async function markBillPaidManually(
  instanceId: string,
  input: { paidAmount?: number | null; paidAt?: string | null } = {},
): Promise<ActionResult> {
  const { error: authError, supabase } = await requireUser();
  if (authError) return { error: authError };
  const db = supabase as unknown as SupabaseClient;

  const result = await markInstancePaid(db, instanceId, {
    matched_transaction_id: null,
    paid_amount: input.paidAmount ?? null,
    paid_at: input.paidAt ?? new Date().toISOString(),
  });
  if ("error" in result) return { error: result.error };

  await ensureNextCycle(db, result.bill_id, result.due_date);
  revalidatePath("/bills");
  return { success: true };
}

export async function unlinkBillPayment(instanceId: string): Promise<ActionResult> {
  const { error: authError, supabase } = await requireUser();
  if (authError) return { error: authError };
  const db = supabase as unknown as SupabaseClient;

  const { error } = await db
    .from("bill_instances")
    .update({
      status: "open",
      matched_transaction_id: null,
      paid_amount: null,
      paid_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", instanceId);
  if (error) return { error: error.message };

  revalidatePath("/bills");
  return { success: true };
}

export async function skipBillInstance(instanceId: string): Promise<ActionResult> {
  const { error: authError, supabase } = await requireUser();
  if (authError) return { error: authError };
  const db = supabase as unknown as SupabaseClient;

  const { data, error } = await db
    .from("bill_instances")
    .update({ status: "skipped", updated_at: new Date().toISOString() })
    .eq("id", instanceId)
    .eq("status", "open")
    .select("bill_id, due_date");
  if (error) return { error: error.message };
  const rows = (data ?? []) as { bill_id: string; due_date: string }[];
  if (rows.length === 0) return { error: "This bill cycle is not open (already resolved)" };

  await ensureNextCycle(db, rows[0].bill_id, rows[0].due_date);
  revalidatePath("/bills");
  return { success: true };
}

export type SeededBillInput = CreateBillInput;

/** Bulk-create bills accepted from the onboarding seed panel. */
export async function acceptSeededBills(
  bills: SeededBillInput[],
): Promise<{ success: true; count: number } | { error: string }> {
  const { error: authError, supabase } = await requireUser();
  if (authError) return { error: authError };
  const db = supabase as unknown as SupabaseClient;
  if (bills.length === 0) return { error: "Nothing selected" };

  let count = 0;
  for (const batch of chunk(bills, 200)) {
    const { data, error } = await db
      .from("bills")
      .insert(batch.map(billColumns))
      .select("id");
    if (error) return { error: error.message };
    count += (data as { id: string }[] | null)?.length ?? 0;
  }

  revalidatePath("/bills");
  return { success: true, count };
}
