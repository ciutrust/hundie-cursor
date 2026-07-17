import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    "/review/:path*",
    "/transactions/:path*",
    "/expense-reports/:path*",
    "/bills/:path*",
    "/reports/:path*",
    "/categories/:path*",
    "/month-close/:path*",
    "/tax-close/:path*",
    "/settings/:path*",
    "/login",
    "/mfa",
  ],
};
