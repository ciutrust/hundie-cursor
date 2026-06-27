import { NextResponse } from "next/server";
import type { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Bank-connection operations require a stepped-up (aal2) session when the user has a verified second
 * factor. This mirrors the /settings/connections page gate so the Plaid API routes can't be called
 * around it (the page redirect alone doesn't protect direct API calls). Users with no enrolled factor
 * are allowed through (there's nothing to step up to).
 *
 * Returns a 401 response to return immediately, or null when the request may proceed.
 */
export async function requireMfaStepUp(
  supabase: SupabaseServerClient,
): Promise<NextResponse | null> {
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const needsStepUp = aal?.currentLevel === "aal1" && aal?.nextLevel === "aal2";
  if (needsStepUp) {
    return NextResponse.json({ error: "MFA step-up required" }, { status: 401 });
  }
  return null;
}
