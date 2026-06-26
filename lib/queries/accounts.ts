import { createClient } from "@/lib/supabase/server";

export type AccountDateRule = {
  from?: string;
  until?: string;
  entity_slug: string;
};

export type AccountWithEntity = {
  id: string;
  display_name: string;
  slug: string;
  account_type: string;
  mixed_use: boolean;
  date_rules: AccountDateRule[];
  default_entity: { id: string; name: string; slug: string } | null;
};

export async function getAccountsWithEntities(): Promise<AccountWithEntity[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accounts")
    .select(
      `
      id,
      display_name,
      slug,
      account_type,
      mixed_use,
      date_rules,
      default_entity:entities!accounts_default_entity_id_fkey(id, name, slug)
    `,
    )
    .eq("is_active", true)
    .order("display_name");

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    display_name: row.display_name,
    slug: row.slug,
    account_type: row.account_type,
    mixed_use: row.mixed_use,
    date_rules: Array.isArray(row.date_rules) ? (row.date_rules as AccountDateRule[]) : [],
    default_entity: row.default_entity,
  }));
}
