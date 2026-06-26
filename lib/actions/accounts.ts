"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { AccountDateRule } from "@/lib/queries/accounts";

export async function updateAccountSettings(input: {
  accountId: string;
  defaultEntityId: string;
  dateRules: AccountDateRule[];
}) {
  const supabase = await createClient();

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
