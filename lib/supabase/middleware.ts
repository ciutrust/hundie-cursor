import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { decideStepUp, pathRequiresStepUp } from "@/lib/plaid/require-mfa";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isProtectedRoute =
    path.startsWith("/review") ||
    path.startsWith("/reports") ||
    path.startsWith("/categories") ||
    path.startsWith("/settings") ||
    path.startsWith("/month-close") ||
    path.startsWith("/tax-close");

  if (!user) {
    if (isProtectedRoute || path === "/mfa") {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("redirect", path + request.nextUrl.search);
      return NextResponse.redirect(url);
    }
    return supabaseResponse;
  }

  // Authenticated. SEC-01: fail-closed step-up decision (the only "allow" is a
  // confirmed aal2 session). The real token boundary is the Plaid API routes
  // (401 on non-allow); these page redirects are UX so the user lands somewhere
  // they can act, and never on a route that would bounce them into a loop.
  const aal = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const verdict = decideStepUp(aal);

  // Step-up is only enforced on the bank-connection surface (the highest-sensitivity
  // area: access tokens, account linking). /login, /mfa, and /settings/security are
  // never gated, so the user can always authenticate and enroll a factor.
  if (pathRequiresStepUp(path)) {
    if (verdict === "step-up") {
      // A verified factor exists → challenge at /mfa (mfa-challenge won't bounce).
      const url = request.nextUrl.clone();
      url.pathname = "/mfa";
      url.searchParams.set("redirect", path + request.nextUrl.search);
      return NextResponse.redirect(url);
    }
    if (verdict === "enroll") {
      // No verified factor, or AAL lookup error/unknown — send to enrollment, NOT
      // /mfa (which would bounce a no-factor user straight back here = redirect loop).
      const url = request.nextUrl.clone();
      url.pathname = "/settings/security";
      return NextResponse.redirect(url);
    }
    // "allow" falls through.
  }

  // Don't strand an authenticated user on /login, and don't sit on /mfa when there's
  // nothing to verify (only a real "step-up" verdict has a factor to challenge).
  if (path === "/login" || (path === "/mfa" && verdict !== "step-up")) {
    const url = request.nextUrl.clone();
    url.pathname = "/review";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
