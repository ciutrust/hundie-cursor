"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import type { AccountDateRule } from "@/lib/queries/accounts";

export async function updateAccountSettings(input: {
  accountId: string;
  defaultEntityId: string;
  dateRules: AccountDateRule[];
}) {
  const auth = await requireUser();
  if (auth.error) return { error: auth.error };

  const supabase = auth.supabase;

  const cleanedRules = input.dateRules
    .filter((rule) => rule.entity_slug && (rule.from || rule.until))
    .map((rule) => ({
      ...(rule.from ? { from: rule.from } : {}),
      ...(rule.until ? { until: rule.until } : {}),
      entity_slug: rule.entity_slug,
    }));

  const { error } = await supabase
    .from("accounts")
    .update({
      default_entity_id: input.defaultEntityId,
      date_rules: cleanedRules,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.accountId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/settings/accounts");
  revalidatePath("/review");
  return { success: true };
}
