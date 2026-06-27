import { NextResponse } from "next/server";
import { aggregator } from "@/lib/aggregator";
import { encryptSecret } from "@/lib/crypto/secret-box";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

/**
 * Exchange the Link public_token for an access token, store the connection (token ENCRYPTED),
 * and return the Plaid accounts so the operator can map them to Hundie accounts. Does NOT create
 * ledger accounts or sync yet — mapping + Sync now are separate steps.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { publicToken?: unknown } | null;
  const publicToken = body?.publicToken;
  if (typeof publicToken !== "string" || !publicToken) {
    return NextResponse.json({ error: "Missing publicToken" }, { status: 400 });
  }

  const exchanged = await aggregator.exchange(publicToken);
  if (!exchanged.ok) return NextResponse.json({ error: exchanged.error }, { status: 502 });

  const accountsResult = await aggregator.listAccounts(exchanged.data.accessToken);
  if (!accountsResult.ok) return NextResponse.json({ error: accountsResult.error }, { status: 502 });
  const accounts = accountsResult.data;
  const institution = accounts[0]?.institution ?? "Unknown";

  const admin = createServiceRoleClient();
  const { data: connection, error } = await admin
    .from("bank_connections")
    .upsert(
      {
        provider: "plaid",
        institution,
        external_item_id: exchanged.data.itemId,
        access_token_cipher: encryptSecret(exchanged.data.accessToken),
        status: "healthy",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "external_item_id" },
    )
    .select("id")
    .single();

  if (error || !connection) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to save connection" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    connectionId: connection.id as string,
    institution,
    accounts: accounts.map((a) => ({
      plaidAccountId: a.externalId,
      name: a.name,
      mask: a.last4,
      type: a.type,
    })),
  });
}
