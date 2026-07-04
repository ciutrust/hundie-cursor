import { NextResponse } from "next/server";
import type { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getSidebarEntityNav } from "@/lib/queries/entity-home";
import { activeMonthPeriod, shiftPeriod, ytdPeriod } from "@/lib/period";
import { buildWeeklyDigest, mergeDigestWindows } from "@/lib/digest";
import { sendEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

/**
 * #1 — weekly "N left to categorize" digest. Vercel Cron hits this GET with an
 * `Authorization: Bearer $CRON_SECRET` header (set automatically when CRON_SECRET is configured).
 * Session-less → uses the service-role client for the backlog counts. Ships INERT: without
 * CRON_SECRET / RESEND_API_KEY / EMAIL_FROM / OPERATOR_EMAIL it just returns a 401/500 and sends
 * nothing. Schedule lives in vercel.json (Mon 09:00 UTC). Reports three windows per entity — YTD,
 * last month, this month — and always sends (0-left is useful).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const to = process.env.OPERATOR_EMAIL;
  if (!to) {
    return NextResponse.json({ error: "OPERATOR_EMAIL is not set" }, { status: 500 });
  }

  try {
    // Service-role client (no user session in a cron); cast to the server-client shape the query expects.
    const admin = createServiceRoleClient() as unknown as Awaited<ReturnType<typeof createClient>>;

    const thisMonth = activeMonthPeriod();
    const lastMonth = shiftPeriod(thisMonth, -1);
    const [ytdItems, lastItems, thisItems] = await Promise.all([
      getSidebarEntityNav(ytdPeriod(), admin),
      getSidebarEntityNav(lastMonth, admin),
      getSidebarEntityNav(thisMonth, admin),
    ]);
    const rows = mergeDigestWindows(ytdItems, lastItems, thisItems);

    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL ??
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
    const digest = buildWeeklyDigest(rows, {
      reviewUrl: `${siteUrl}/review`,
      lastMonthLabel: lastMonth.label,
      thisMonthLabel: thisMonth.label,
    });

    await sendEmail({ to, subject: digest.subject, html: digest.html });
    return NextResponse.json({ ok: true, total: digest.total });
  } catch (err) {
    const message = err instanceof Error ? err.message : "digest failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
