import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireMfaStepUp, requireSameOrigin } from "@/lib/plaid/require-mfa";
import { runLiabilitiesSync } from "@/lib/plaid/sync-liabilities";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isUuid } from "@/lib/uuid";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Refresh seeded liability balances. Pass connectionId to limit the pull to one bank. */
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
  if (body?.connectionId && !isUuid(body.connectionId)) {
    return NextResponse.json({ error: "Invalid connectionId" }, { status: 400 });
  }

  try {
    const summary = await runLiabilitiesSync(createServiceRoleClient(), body?.connectionId);
    return NextResponse.json(summary);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Liabilities sync failed" },
      { status: 500 },
    );
  }
}
