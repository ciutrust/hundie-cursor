import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export type ConnectionLink = {
  plaidAccountId: string;
  plaidName: string | null;
  plaidMask: string | null;
  plaidType: string | null;
  accountId: string;
  accountName: string | null;
};

export type ConnectionView = {
  id: string;
  institution: string | null;
  status: string;
  lastSyncedAt: string | null;
  links: ConnectionLink[];
};

/**
 * Read connections + their account links via the SERVICE-ROLE client (the Plaid tables have no
 * anon/authenticated policies). Returns only non-secret fields — the encrypted token never leaves
 * this server module.
 */
export async function getConnections(): Promise<ConnectionView[]> {
  const admin = createServiceRoleClient();
  const [{ data: connections, error: cErr }, { data: links, error: lErr }] = await Promise.all([
    admin
      .from("bank_connections")
      .select("id, institution, status, last_synced_at")
      .order("created_at", { ascending: true }),
    admin
      .from("plaid_account_links")
      .select(
        "connection_id, plaid_account_id, plaid_name, plaid_mask, plaid_type, account_id, accounts(display_name)",
      ),
  ]);
  if (cErr) throw cErr;
  if (lErr) throw lErr;

  const byConnection = new Map<string, ConnectionLink[]>();
  for (const l of links ?? []) {
    const arr = byConnection.get(l.connection_id) ?? [];
    arr.push({
      plaidAccountId: l.plaid_account_id,
      plaidName: l.plaid_name,
      plaidMask: l.plaid_mask,
      plaidType: l.plaid_type,
      accountId: l.account_id,
      // untyped client types the to-one embed as an array; it's an object at runtime
      accountName: (l.accounts as unknown as { display_name: string } | null)?.display_name ?? null,
    });
    byConnection.set(l.connection_id, arr);
  }

  return (connections ?? []).map((c) => ({
    id: c.id,
    institution: c.institution,
    status: c.status,
    lastSyncedAt: c.last_synced_at,
    links: byConnection.get(c.id) ?? [],
  }));
}

export type MappableAccount = {
  id: string;
  displayName: string;
  accountType: string;
  issuerParser: string;
};

/** Active seeded Hundie accounts for the mapping dropdown (includes issuer_parser for auto-match). */
export async function getMappableAccounts(): Promise<MappableAccount[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accounts")
    .select("id, display_name, account_type, issuer_parser")
    .eq("is_active", true)
    .order("display_name");
  if (error) throw error;
  return (data ?? []).map((a) => ({
    id: a.id,
    displayName: a.display_name,
    accountType: a.account_type,
    issuerParser: a.issuer_parser,
  }));
}
