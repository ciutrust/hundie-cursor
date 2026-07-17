import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { getAiPreclassifiedCount } from "@/lib/queries/ai-suggestions";
import { getSidebarEntityNav, type SidebarEntityNavItem } from "@/lib/queries/entity-home";
import { ytdPeriod } from "@/lib/period";
import { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

function initialsFromLabel(label: string) {
  const parts = label.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  }
  return label.slice(0, 2).toUpperCase();
}

function labelFromEmail(email: string) {
  const local = email.split("@")[0] ?? email;
  return local
    .split(/[._-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

// Display-only: middleware already authenticated this request, so the shell just needs a label.
// getClaims verifies the JWT locally when the project uses asymmetric signing keys (legacy HS256
// projects still round-trip, same as getUser - parity, not a regression); getUser stays as the
// fallback so a claims miss never blanks the label.
async function getUserDisplay(supabase: SupabaseServerClient) {
  const { data, error } = await supabase.auth.getClaims();
  if (!error && data?.claims) {
    return {
      email: typeof data.claims.email === "string" ? data.claims.email : null,
      fullName:
        typeof data.claims.user_metadata?.full_name === "string"
          ? data.claims.user_metadata.full_name
          : null,
    };
  }

  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  return {
    email: user?.email ?? null,
    fullName:
      typeof user?.user_metadata?.full_name === "string" ? user.user_metadata.full_name : null,
  };
}

async function getEntityNavLite(supabase: SupabaseServerClient): Promise<SidebarEntityNavItem[]> {
  const { data } = await supabase
    .from("entities")
    .select("slug, name")
    .eq("is_classifiable", true)
    .order("display_order");
  return (data ?? []).map((entity) => ({
    slug: entity.slug,
    name: entity.name,
    unclassifiedCount: 0,
  }));
}

async function getEntityNavFull(supabase: SupabaseServerClient): Promise<SidebarEntityNavItem[]> {
  try {
    return await getSidebarEntityNav(ytdPeriod());
  } catch (error) {
    console.error("Sidebar entity nav failed:", error);
    return getEntityNavLite(supabase);
  }
}

/**
 * variant="lite" skips the badge counts (AI awaiting + per-entity backlog) so pages that must
 * paint fast (/capture on a phone) block on one cheap entities select instead of the full
 * count fan-out. Nav links render without badges - intended tradeoff.
 */
export async function AppShellWrapper({
  children,
  variant = "full",
}: {
  children: React.ReactNode;
  variant?: "full" | "lite";
}) {
  const supabase = await createClient();

  const [display, aiAwaitingCount, entities] = await (variant === "lite"
    ? Promise.all([getUserDisplay(supabase), 0, getEntityNavLite(supabase)])
    : Promise.all([
        getUserDisplay(supabase),
        getAiPreclassifiedCount(),
        getEntityNavFull(supabase),
      ]));

  const userLabel = display.fullName ?? (display.email ? labelFromEmail(display.email) : "Signed in");
  const userInitials = initialsFromLabel(userLabel);

  return (
    <Suspense fallback={<div className="min-h-screen bg-background lg:pl-60">{children}</div>}>
      <AppShell
        entities={entities}
        aiAwaitingCount={aiAwaitingCount}
        userLabel={userLabel}
        userInitials={userInitials}
      >
        {children}
      </AppShell>
    </Suspense>
  );
}
