import { NextResponse } from "next/server";
import { aggregator } from "@/lib/aggregator";
import { decryptSecret } from "@/lib/crypto/secret-box";
import { createClient } from "@/lib/supabase/server";
import { requireMfaStepUp, requireSameOrigin } from "@/lib/plaid/require-mfa";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

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
  if (!body?.connectionId) {
    return NextResponse.json({ error: "Missing connectionId" }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const { data: conn } = await admin
    .from("bank_connections")
    .select("access_token_cipher")
    .eq("id", body.connectionId)
    .single();

  if (conn) {
    try {
      await aggregator.removeItem(decryptSecret(conn.access_token_cipher));
    } catch {
      // best-effort revoke — proceed with local delete regardless
    }
  }

  const { error } = await admin.from("bank_connections").delete().eq("id", body.connectionId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
