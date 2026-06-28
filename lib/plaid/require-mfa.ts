import { NextResponse } from "next/server";
import type { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// ── SEC-01: MFA step-up decision (pure, FAIL-CLOSED) ─────────────────────────

type AalData = { currentLevel: string | null; nextLevel: string | null } | null;
export type AalResult = { data: AalData; error: unknown };
export type StepUpVerdict = "allow" | "step-up" | "enroll";

/**
 * Pure, FAIL-CLOSED step-up decision. The ONLY allow case is a session that has
 * actually completed the second factor (currentLevel === "aal2").
 *   allow    — currentLevel aal2 (proceed)
 *   step-up  — aal1 + nextLevel aal2 (a verified factor exists → challenge at /mfa)
 *   enroll   — no verified factor (nextLevel aal1) OR error/null/unknown
 *              (fail closed → send to /settings/security to enroll a factor)
 */
export function decideStepUp(aal: AalResult): StepUpVerdict {
  if (aal.error || !aal.data) return "enroll"; // fail closed on error/null
  const { currentLevel, nextLevel } = aal.data;
  if (currentLevel === "aal2") return "allow";
  if (currentLevel === "aal1" && nextLevel === "aal2") return "step-up";
  return "enroll"; // no-factor (aal1/aal1) or unknown
}

const STEP_UP_PREFIX = "/settings/connections";

/**
 * Only the bank-token surface is gated for step-up. /login, /mfa, and
 * /settings/security are intentionally NOT gated so the user can always
 * authenticate and enroll a factor.
 */
export function pathRequiresStepUp(path: string): boolean {
  return path === STEP_UP_PREFIX || path.startsWith(STEP_UP_PREFIX + "/");
}

/**
 * Bank-connection operations require a stepped-up (aal2) session. This mirrors the
 * /settings/connections page gate so the Plaid API routes can't be called around it
 * (the page redirect alone doesn't protect direct API calls). FAIL-CLOSED: anything
 * other than a confirmed aal2 session (no factor, aal1, AAL lookup error, null) is
 * denied with a 401 so a forged or pre-step-up call can't reach a bank token.
 *
 * Returns a 401 response to return immediately, or null when the request may proceed.
 */
export async function requireMfaStepUp(
  supabase: SupabaseServerClient,
): Promise<NextResponse | null> {
  const aal = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (decideStepUp(aal) === "allow") return null;
  return NextResponse.json({ error: "MFA step-up required" }, { status: 401 });
}

// ── SEC-06: same-origin / CSRF guard for mutating Plaid POST routes ───────────

/**
 * Pure: the Origin header must be present and its host must equal the request host.
 * Fail closed otherwise. Browsers send Origin on cross-site (and same-site) POST
 * fetches, so a missing Origin on a mutating request is treated as suspicious.
 * URL.host includes the port, so dev (localhost:3000) still matches itself.
 */
export function isSameOrigin(origin: string | null, host: string | null): boolean {
  if (!host || !origin) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false; // malformed Origin
  }
}

/**
 * Reject non-same-origin mutating requests. Returns a 403 response to return
 * immediately, or null when the request is same-origin and may proceed.
 */
export function requireSameOrigin(request: Request): NextResponse | null {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (isSameOrigin(origin, host)) return null;
  return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
}
