"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/uuid";

export async function updateAssetValue(input: { id: string; value: number }) {
  if (!isUuid(input.id)) return { error: "Invalid asset" };
  if (!Number.isFinite(input.value) || input.value < 0 || input.value > 99_999_999_999) {
    return { error: "Enter a dollar amount" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const next = Math.round(input.value * 100) / 100;
  const { data: row, error: readError } = await supabase
    .from("assets")
    .select("id, current_value")
    .eq("id", input.id)
    .maybeSingle();
  if (readError) return { error: readError.message };
  if (!row) return { error: "Asset not found" };
  if (Number(row.current_value) === next) return { success: true };

  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("assets")
    .update({ current_value: next, updated_at: now })
    .eq("id", input.id);
  if (updateError) return { error: updateError.message };

  const { error: historyError } = await supabase.from("asset_value_history").insert({
    asset_id: input.id,
    value: next,
    source: "manual",
    notes: "Updated on the assets page",
  });
  if (historyError) return { error: historyError.message };

  revalidatePath("/assets");
  revalidatePath("/net-worth");
  return { success: true };
}
