import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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

  // Authenticated. A verified second factor exists but this session is still single-factor (aal1)?
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const needsMfa = aal?.currentLevel === "aal1" && aal?.nextLevel === "aal2";

  // MFA step-up is only required for the bank-connection screen — the highest-sensitivity area
  // (access tokens, account linking). Day-to-day classifying stays single-factor and un-gated.
  const requiresStepUp = path.startsWith("/settings/connections");

  if (needsMfa && requiresStepUp && path !== "/mfa") {
    const url = request.nextUrl.clone();
    url.pathname = "/mfa";
    url.searchParams.set("redirect", path + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  // Don't strand an authenticated user on /login, and don't sit on /mfa when there's no step-up to do.
  if (path === "/login" || (path === "/mfa" && !needsMfa)) {
    const url = request.nextUrl.clone();
    url.pathname = "/review";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
