import { NextResponse } from "next/server";
import { aggregator } from "@/lib/aggregator";
import { decryptSecret } from "@/lib/crypto/secret-box";
import { createClient } from "@/lib/supabase/server";
import { requireMfaStepUp, requireSameOrigin } from "@/lib/plaid/require-mfa";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isUuid } from "@/lib/uuid";

export const runtime = "nodejs";

/**
 * List the LIVE Plaid accounts for an EXISTING connection, each flagged mapped/unmapped/ignored.
 * A connection stuck at needs_mapping has Plaid accounts with no plaid_account_links row, and
 * nothing on the page knows what they are — getConnections() only returns MAPPED links. This is
 * the read side of mapping an already-connected item without re-running Plaid Link.
 * The decrypted access token never leaves this module.
 */
export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const mfaError = await requireMfaStepUp(supabase);
  if (mfaError) return mfaError;

  const body = (await request.json().catch(() => null)) as { connectionId?: string } | null;
  if (!body || !isUuid(body.connectionId)) {
    return NextResponse.json({ error: "Invalid connectionId" }, { status: 400 });
  }
  const connectionId = body.connectionId;

  const admin = createServiceRoleClient();
  const { data: conn } = await admin
    .from("bank_connections")
    .select("institution, access_token_cipher")
    .eq("id", connectionId)
    .single();
  if (!conn) return NextResponse.json({ error: "Unknown connection" }, { status: 400 });

  let token: string;
  try {
    token = decryptSecret(conn.access_token_cipher);
  } catch {
    return NextResponse.json(
      { error: "Could not decrypt token (encryption key may have changed). Remove and re-link this bank." },
      { status: 500 },
    );
  }

  const accountsResult = await aggregator.listAccounts(token);
  if (!accountsResult.ok) {
    return NextResponse.json({ error: accountsResult.error }, { status: 502 });
  }

  // Existing links for THIS connection only — a plaid_account_id is globally unique, so scoping by
  // connection can't hide a link that belongs to these accounts.
  const { data: links, error: lErr } = await admin
    .from("plaid_account_links")
    .select("plaid_account_id, account_id, accounts(display_name)")
    .eq("connection_id", connectionId);
  if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 });

  // Accounts the operator marked "don't track". They have no link and never will, so without this
  // the mapper would keep presenting them as work to do — the thing that kept these connections
  // pinned at needs_mapping.
  const { data: ignoredRows, error: iErr } = await admin
    .from("plaid_ignored_accounts")
    .select("plaid_account_id, reason")
    .eq("connection_id", connectionId);
  if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });
  // reason is carried back so the panel can show the operator their own words instead of just a
  // "not tracked" label — it's the whole point of storing it.
  const ignored = new Map<string, string | null>(
    (ignoredRows ?? []).map((r) => [r.plaid_account_id as string, (r.reason as string | null) ?? null]),
  );

  const mapped = new Map<string, { accountId: string; accountName: string | null }>();
  for (const l of links ?? []) {
    mapped.set(l.plaid_account_id, {
      accountId: l.account_id,
      // untyped client types the to-one embed as an array; it's an object at runtime
      accountName: (l.accounts as unknown as { display_name: string } | null)?.display_name ?? null,
    });
  }

  return NextResponse.json({
    connectionId,
    institution: (conn.institution as string | null) ?? accountsResult.data[0]?.institution ?? null,
    accounts: accountsResult.data.map((a) => {
      const link = mapped.get(a.externalId);
      return {
        plaidAccountId: a.externalId,
        name: a.name,
        mask: a.last4,
        type: a.type,
        mappedAccountId: link?.accountId ?? null,
        mappedAccountName: link?.accountName ?? null,
        ignored: ignored.has(a.externalId),
        ignoredReason: ignored.get(a.externalId) ?? null,
      };
    }),
  });
}
