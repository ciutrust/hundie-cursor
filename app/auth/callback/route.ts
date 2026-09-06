import { NextResponse } from "next/server";
import { safeRedirectPath } from "@/lib/auth/safe-redirect";
import { postAuthRedirectUrl } from "@/lib/auth/sign-in-options";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const oauthError = searchParams.get("error");
  const redirectTo = safeRedirectPath(searchParams.get("redirect"));
  const forwardedHost = request.headers.get("x-forwarded-host");
  const isLocalEnv = process.env.NODE_ENV === "development";
  const redirect = (path: string) =>
    NextResponse.redirect(postAuthRedirectUrl(origin, path, forwardedHost, isLocalEnv));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return redirect(redirectTo);
    }
  }

  const errorCode = oauthError === "access_denied" ? "access_denied" : "auth";
  return redirect(`/login?error=${errorCode}`);
}
