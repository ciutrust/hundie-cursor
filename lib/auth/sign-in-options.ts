import type { SignInWithPasswordlessCredentials } from "@supabase/supabase-js";

type OtpOptions = NonNullable<
  Extract<SignInWithPasswordlessCredentials, { email: string }>["options"]
>;

/**
 * Options for the magic-link (OTP) sign-in. shouldCreateUser is FALSE: this app is
 * single-tenant (allowlisted sign-ins only), so an OTP request for an unknown email
 * must fail rather than self-register a new authenticated user (every RLS policy today
 * trusts any authenticated JWT).
 */
export function magicLinkOtpOptions(origin: string, redirectTo: string): OtpOptions {
  return {
    shouldCreateUser: false,
    emailRedirectTo: `${origin}/auth/callback?redirect=${encodeURIComponent(redirectTo)}`,
  };
}
