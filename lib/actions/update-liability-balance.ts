"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/uuid";

export async function updateLiabilityBalance(input: { id: string; balance: number }) {
  if (!isUuid(input.id)) return { error: "Invalid liability" };
  if (!Number.isFinite(input.balance) || input.balance < 0 || input.balance > 99_999_999_999) {
    return { error: "Enter a dollar amount" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const next = Math.round(input.balance * 100) / 100;
  const { data: row, error: readError } = await supabase
    .from("liabilities")
    .select("id, current_balance, plaid_account_id")
    .eq("id", input.id)
    .maybeSingle();
  if (readError) return { error: readError.message };
  if (!row) return { error: "Liability not found" };
  if (row.plaid_account_id) return { error: "This balance comes from Plaid" };
  if (Number(row.current_balance) === next) return { success: true };

  const { error: updateError } = await supabase
    .from("liabilities")
    .update({ current_balance: next, updated_at: new Date().toISOString() })
    .eq("id", input.id);
  if (updateError) return { error: updateError.message };

  revalidatePath("/liabilities");
  revalidatePath("/assets");
  revalidatePath("/net-worth");
  return { success: true };
}
