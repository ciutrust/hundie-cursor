import { NextResponse } from "next/server";
import { aggregator } from "@/lib/aggregator";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Mint a Plaid Link token for the signed-in operator to open the Link widget.
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const result = await aggregator.linkToken("hundie-operator");
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.notConfigured ? 503 : 502 });
  }
  return NextResponse.json({ linkToken: result.data });
}
