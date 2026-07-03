import { NextResponse } from "next/server";
import { aggregator } from "@/lib/aggregator";
import { decryptSecret } from "@/lib/crypto/secret-box";
import { createClient } from "@/lib/supabase/server";
import { requireMfaStepUp, requireSameOrigin } from "@/lib/plaid/require-mfa";
import { shouldDeleteConnection } from "@/lib/plaid/disconnect-plan";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isUuid } from "@/lib/uuid";

export const runtime = "nodejs";

/**
 * Remove a connection: revoke the token at Plaid (best-effort), then delete the connection row
 * (cascades plaid_account_links). Already-imported transactions are kept — only future syncing stops.
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

  const admin = createServiceRoleClient();
  const { data: conn } = await admin
    .from("bank_connections")
    .select("access_token_cipher")
    .eq("id", body.connectionId)
    .single();

  let revoke: Awaited<ReturnType<typeof aggregator.removeItem>> | null = null;
  if (conn) {
    let token: string | null = null;
    try {
      token = decryptSecret(conn.access_token_cipher);
    } catch {
      // Token can't be decrypted (key rotated) — it's already unusable and un-revocable at Plaid;
      // log and fall through to delete the dead row (revoke stays null → deletable).
      console.error(
        `Plaid disconnect: could not decrypt token for connection ${body.connectionId}; deleting the unusable row`,
      );
    }
    if (token) {
      revoke = await aggregator.removeItem(token);
    }
  }

  // S7: don't delete the only token copy while the item is still authorized at Plaid — a failed
  // revoke keeps the row so the operator can retry, instead of silently orphaning the authorization.
  if (!shouldDeleteConnection(revoke)) {
    const reason = revoke && !revoke.ok ? revoke.error : "unknown";
    console.error(`Plaid item revoke failed for connection ${body.connectionId}: ${reason}`);
    return NextResponse.json(
      { error: "Could not revoke the bank connection at Plaid. Please try again." },
      { status: 502 },
    );
  }

  const { error } = await admin.from("bank_connections").delete().eq("id", body.connectionId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
