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

  // Authenticated. If a verified second factor exists but this session is still single-factor
  // (aal1), require the MFA challenge before anything else.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const needsMfa = aal?.currentLevel === "aal1" && aal?.nextLevel === "aal2";

  if (needsMfa && path !== "/mfa") {
    const url = request.nextUrl.clone();
    url.pathname = "/mfa";
    if (isProtectedRoute) url.searchParams.set("redirect", path + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  if (!needsMfa && (path === "/mfa" || path === "/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/review";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
