import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    "/review/:path*",
    "/reports/:path*",
    "/month-close/:path*",
    "/tax-close/:path*",
    "/settings/:path*",
    "/login",
  ],
};
