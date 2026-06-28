import { NextResponse } from "next/server";
import { aggregator } from "@/lib/aggregator";
import { createClient } from "@/lib/supabase/server";
import { requireMfaStepUp, requireSameOrigin } from "@/lib/plaid/require-mfa";

export const runtime = "nodejs";

// Mint a Plaid Link token for the signed-in operator to open the Link widget.
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

  const result = await aggregator.linkToken("hundie-operator");
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.notConfigured ? 503 : 502 });
  }
  return NextResponse.json({ linkToken: result.data });
}
