import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { getAiPreclassifiedCount } from "@/lib/queries/ai-suggestions";
import { getSidebarEntityNav } from "@/lib/queries/entity-home";
import { ytdPeriod } from "@/lib/period";
import { createClient } from "@/lib/supabase/server";

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

export async function AppShellWrapper({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const [{ data: { user } }, aiAwaitingCount] = await Promise.all([
    supabase.auth.getUser(),
    getAiPreclassifiedCount(),
  ]);

  let entities;
  try {
    entities = await getSidebarEntityNav(ytdPeriod());
  } catch (error) {
    console.error("Sidebar entity nav failed:", error);
    const { data } = await supabase
      .from("entities")
      .select("slug, name")
      .eq("is_classifiable", true)
      .order("display_order");
    entities = (data ?? []).map((entity) => ({
      slug: entity.slug,
      name: entity.name,
      unclassifiedCount: 0,
    }));
  }

  const metadataName =
    typeof user?.user_metadata?.full_name === "string" ? user.user_metadata.full_name : null;
  const userLabel = metadataName ?? (user?.email ? labelFromEmail(user.email) : "Signed in");
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
