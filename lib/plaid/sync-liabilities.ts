import { aggregator } from "@/lib/aggregator";
import { decryptSecret } from "@/lib/crypto/secret-box";
import {
  liabilityErrorNeedsConsent,
  matchLiabilities,
  type LiabilityRow,
} from "@/lib/plaid/match-liabilities";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

type Admin = ReturnType<typeof createServiceRoleClient>;

export type LiabilitySyncConnection = {
  connectionId: string;
  institution: string | null;
  updated: { id: string; name: string; balance: number | null; apr: number | null }[];
  unmatched: {
    accountId: string;
    name: string;
    mask: string | null;
    kind: string;
    balance: number | null;
    apr: number | null;
    institution: string;
  }[];
  needsConsent: boolean;
  error?: string;
};

/**
 * Pull /liabilities/get for each connection and write balance + APR onto existing rows.
 * Does not insert. A missing product comes back as needsConsent so the UI can open Link.
 */
export async function runLiabilitiesSync(
  admin: Admin,
  connectionId?: string,
): Promise<{ connections: LiabilitySyncConnection[]; needsConsent: boolean }> {
  let query = admin.from("bank_connections").select("id, institution, access_token_cipher");
  if (connectionId) query = query.eq("id", connectionId);
  const { data: connections, error: connectionError } = await query;
  if (connectionError) throw connectionError;

  const { data: rows, error: rowError } = await admin
    .from("liabilities")
    .select("id, type, name, plaid_account_id");
  if (rowError) throw rowError;

  const liabilityRows: LiabilityRow[] = (rows ?? []).map((row) => ({
    id: row.id as string,
    type: row.type as string,
    name: row.name as string,
    plaidAccountId: (row.plaid_account_id as string | null) ?? null,
  }));

  const claimed = new Set<string>();
  const results: LiabilitySyncConnection[] = [];

  for (const conn of connections ?? []) {
    const result: LiabilitySyncConnection = {
      connectionId: conn.id,
      institution: conn.institution,
      updated: [],
      unmatched: [],
      needsConsent: false,
    };

    try {
      let token: string;
      try {
        token = decryptSecret(conn.access_token_cipher);
      } catch {
        result.error = "Could not decrypt the saved token. Remove and re-link this bank.";
        results.push(result);
        continue;
      }

      const pulled = await aggregator.getLiabilities(token);
      if (!pulled.ok) {
        result.needsConsent = liabilityErrorNeedsConsent(pulled.error);
        result.error = pulled.error;
        results.push(result);
        continue;
      }

      const openRows = liabilityRows.filter((row) => !claimed.has(row.id));
      const { matched, unmatched } = matchLiabilities(openRows, pulled.data);
      const now = new Date().toISOString();

      for (const assignment of matched) {
        const patch: {
          plaid_account_id: string;
          last_synced_at: string;
          updated_at: string;
          current_balance?: number;
          interest_rate?: number;
        } = {
          plaid_account_id: assignment.plaid.accountId,
          last_synced_at: now,
          updated_at: now,
        };
        if (assignment.plaid.balance != null) patch.current_balance = assignment.plaid.balance;
        if (assignment.plaid.apr != null) patch.interest_rate = assignment.plaid.apr;

        const { error } = await admin.from("liabilities").update(patch).eq("id", assignment.rowId);
        if (error) throw new Error(error.message);

        claimed.add(assignment.rowId);
        const row = liabilityRows.find((item) => item.id === assignment.rowId);
        if (row) row.plaidAccountId = assignment.plaid.accountId;
        result.updated.push({
          id: assignment.rowId,
          name: row?.name ?? assignment.rowId,
          balance: assignment.plaid.balance,
          apr: assignment.plaid.apr,
        });
      }

      result.unmatched = unmatched.map((item) => ({
        accountId: item.accountId,
        name: item.name,
        mask: item.mask,
        kind: item.kind,
        balance: item.balance,
        apr: item.apr,
        institution: item.institution,
      }));
    } catch (e) {
      result.error = e instanceof Error ? e.message : "Liabilities sync failed";
    }

    results.push(result);
  }

  return {
    connections: results,
    needsConsent: results.some((item) => item.needsConsent),
  };
}
