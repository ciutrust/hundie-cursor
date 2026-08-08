import { requireUser } from "@/lib/auth/require-user";
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

/** A Plaid account the operator marked "don't track" — resolved for the sync gate, never imported. */
export type IgnoredAccount = {
  plaidAccountId: string;
  plaidName: string | null;
  plaidMask: string | null;
  reason: string | null;
};

export type ConnectionView = {
  id: string;
  institution: string | null;
  status: string;
  lastSyncedAt: string | null;
  /** #10: the cutover date — transactions before this are not pulled from Plaid (CSV owns the pre-cutover history). */
  syncFromDate: string | null;
  links: ConnectionLink[];
  /**
   * Deliberately excluded accounts. Carried here so the page can show them standing: once they are
   * ignored the connection goes back to 'healthy', and without this the fact that real bank accounts
   * are out of scope would only be visible behind an MFA-gated live Plaid call.
   */
  ignored: IgnoredAccount[];
};

/**
 * Read connections + their account links via the SERVICE-ROLE client (the Plaid tables have no
 * anon/authenticated policies). Returns only non-secret fields — the encrypted token never leaves
 * this server module.
 */
export async function getConnections(): Promise<ConnectionView[]> {
  // S3: defense-in-depth on the most sensitive read. This uses the service-role client (the Plaid
  // tables have no authenticated policies), so it must not rely on the middleware matcher alone — a
  // matcher regression (the `/categories` class of mistake) would otherwise expose connection
  // metadata. An unauthenticated caller gets an empty list, never connection data.
  const { error: authError } = await requireUser();
  if (authError) return [];

  const admin = createServiceRoleClient();
  const [
    { data: connections, error: cErr },
    { data: links, error: lErr },
    { data: ignoredRows, error: iErr },
  ] = await Promise.all([
    admin
      .from("bank_connections")
      .select("id, institution, status, last_synced_at, sync_from_date")
      .order("created_at", { ascending: true }),
    admin
      .from("plaid_account_links")
      .select(
        "connection_id, plaid_account_id, plaid_name, plaid_mask, plaid_type, account_id, accounts(display_name)",
      ),
    admin
      .from("plaid_ignored_accounts")
      .select("connection_id, plaid_account_id, plaid_name, plaid_mask, reason"),
  ]);
  if (cErr) throw cErr;
  if (lErr) throw lErr;
  if (iErr) throw iErr;

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

  // A link is the stronger fact: if an account somehow carried both, it IS importing, so listing it
  // as excluded would be a lie. (map-accounts and ignore-accounts each refuse the other's rows, so
  // this should be unreachable — it's here so the page can't misreport if it ever happens.)
  const linkedPlaidIds = new Set((links ?? []).map((l) => l.plaid_account_id));
  const ignoredByConnection = new Map<string, IgnoredAccount[]>();
  for (const r of ignoredRows ?? []) {
    if (linkedPlaidIds.has(r.plaid_account_id)) continue;
    const arr = ignoredByConnection.get(r.connection_id) ?? [];
    arr.push({
      plaidAccountId: r.plaid_account_id,
      plaidName: r.plaid_name,
      plaidMask: r.plaid_mask,
      reason: r.reason,
    });
    ignoredByConnection.set(r.connection_id, arr);
  }

  return (connections ?? []).map((c) => ({
    id: c.id,
    institution: c.institution,
    status: c.status,
    lastSyncedAt: c.last_synced_at,
    syncFromDate: (c as { sync_from_date?: string | null }).sync_from_date ?? null,
    links: byConnection.get(c.id) ?? [],
    ignored: ignoredByConnection.get(c.id) ?? [],
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
