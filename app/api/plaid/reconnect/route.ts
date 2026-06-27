import { NextResponse } from "next/server";
import { aggregator } from "@/lib/aggregator";
import { decryptSecret } from "@/lib/crypto/secret-box";
import { createClient } from "@/lib/supabase/server";
import { requireMfaStepUp } from "@/lib/plaid/require-mfa";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

/** Start a Plaid update-mode re-auth for an existing connection (keeps the same access token). */
export async function POST(request: Request) {
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
  const { data: conn, error } = await admin
    .from("bank_connections")
    .select("access_token_cipher")
    .eq("id", body.connectionId)
    .single();
  if (error || !conn) return NextResponse.json({ error: "Connection not found" }, { status: 404 });

  let token: string;
  try {
    token = decryptSecret(conn.access_token_cipher);
  } catch {
    return NextResponse.json(
      { error: "Could not decrypt token (encryption key may have changed). Remove and re-link this bank." },
      { status: 500 },
    );
  }

  const result = await aggregator.linkTokenForUpdate(token);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.notConfigured ? 503 : 502 });
  }
  return NextResponse.json({ linkToken: result.data });
}
