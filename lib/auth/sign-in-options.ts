/** PKCE return URL after Google OAuth. Must be on the Supabase redirect allowlist. */
export function googleOAuthRedirectTo(origin: string, redirectPath: string): string {
  return `${origin}/auth/callback?redirect=${encodeURIComponent(redirectPath)}`;
}

/** Map /login?error= codes from the OAuth callback (unknown codes stay generic). */
export function loginErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  if (code === "access_denied") return "Google sign-in was cancelled.";
  return "Sign-in was rejected. This Google account cannot use Hundie.";
}

/** Prefer the public Vercel host over the internal origin after OAuth. */
export function postAuthRedirectUrl(
  origin: string,
  path: string,
  forwardedHost: string | null,
  isLocalEnv: boolean,
): string {
  if (isLocalEnv || !forwardedHost) return `${origin}${path}`;
  return `https://${forwardedHost}${path}`;
}
