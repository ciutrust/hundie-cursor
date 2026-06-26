"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Brain,
  Building2,
  CheckCircle2,
  FileSpreadsheet,
  LayoutGrid,
  Settings2,
  Sparkles,
} from "lucide-react";
import { signOut } from "@/lib/actions/reclassify";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  match: (path: string) => boolean;
  badge?: number;
  disabled?: boolean;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

type AppShellProps = {
  children: React.ReactNode;
  backlogCount: number;
  aiReviewCount: number;
  userLabel: string;
  userInitials: string;
};

function buildNav(backlogCount: number, aiReviewCount: number): NavGroup[] {
  return [
    {
      label: "Classify",
      items: [
        {
          href: "/review",
          label: "Review",
          icon: LayoutGrid,
          match: (path) =>
            path === "/review" || (path.startsWith("/review/") && path !== "/review/unclassified"),
        },
        {
          href: "/review/unclassified",
          label: "Backlog",
          icon: Sparkles,
          match: (path) => path.startsWith("/review/unclassified"),
          badge: backlogCount > 0 ? backlogCount : undefined,
        },
        {
          href: "/review/personal?category=unclassified",
          label: "AI review",
          icon: Brain,
          match: (path) =>
            path.startsWith("/review/personal") && path.includes("category=unclassified"),
          badge: aiReviewCount > 0 ? aiReviewCount : undefined,
        },
      ],
    },
    {
      label: "Tax readiness",
      items: [
        {
          href: "#",
          label: "Month close",
          icon: CheckCircle2,
          match: () => false,
          disabled: true,
        },
        {
          href: "/reports",
          label: "Reports & export",
          icon: FileSpreadsheet,
          match: (path) => path.startsWith("/reports"),
        },
      ],
    },
    {
      label: "Setup",
      items: [
        {
          href: "/settings/accounts",
          label: "Accounts",
          icon: Settings2,
          match: (path) => path.startsWith("/settings"),
        },
        {
          href: "#",
          label: "Entities & rules",
          icon: Building2,
          match: () => false,
          disabled: true,
        },
      ],
    },
  ];
}

export function AppShell({ children, backlogCount, aiReviewCount, userLabel, userInitials }: AppShellProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const navGroups = buildNav(backlogCount, aiReviewCount);

  function isNavActive(item: NavItem) {
    if (item.href === "/review/personal?category=unclassified") {
      return pathname === "/review/personal" && searchParams.get("category") === "unclassified";
    }
    return item.match(pathname);
  }

  return (
    <div className="min-h-screen bg-background lg:flex">
      <aside className="print:hidden lg:fixed lg:inset-y-0 lg:flex lg:w-60 lg:flex-col lg:border-r lg:border-sidebar-border lg:bg-sidebar">
        <div className="flex h-full flex-col">
          <div className="border-b border-sidebar-border px-4 py-5">
            <Link href="/review" className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                H
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">Hundie</p>
                <p className="truncate text-xs text-muted-foreground">Multi-entity ledger</p>
              </div>
            </Link>
          </div>

          <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
            {navGroups.map((group) => (
              <div key={group.label}>
                <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </p>
                <ul className="space-y-0.5">
                  {group.items.map((item) => {
                    const active = isNavActive(item);
                    const Icon = item.icon;

                    if (item.disabled) {
                      return (
                        <li key={item.label}>
                          <span
                            className="flex cursor-not-allowed items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted-foreground/50"
                            title="Coming soon"
                          >
                            <Icon className="h-4 w-4 shrink-0" />
                            <span className="flex-1">{item.label}</span>
                          </span>
                        </li>
                      );
                    }

                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          className={cn(
                            "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
                            active
                              ? "bg-primary/15 text-primary"
                              : "text-muted-foreground hover:bg-accent hover:text-foreground",
                          )}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          <span className="flex-1">{item.label}</span>
                          {item.badge != null ? (
                            <span className="rounded-full bg-destructive/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-destructive">
                              {item.badge}
                            </span>
                          ) : null}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>

          <div className="border-t border-sidebar-border p-3">
            <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                {userInitials}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{userLabel}</p>
                <form action={signOut}>
                  <button type="submit" className="text-xs text-muted-foreground hover:text-foreground">
                    Sign out
                  </button>
                </form>
              </div>
              <ThemeToggle />
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col lg:pl-60">
        <header className="border-b border-border bg-background/90 backdrop-blur-md lg:hidden print:hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <Link href="/review" className="text-sm font-semibold">
              Hundie
            </Link>
            <ThemeToggle />
          </div>
          <nav className="flex gap-1 overflow-x-auto px-4 pb-3">
            {navGroups.flatMap((group) =>
              group.items
                .filter((item) => !item.disabled)
                .map((item) => {
                  const active = isNavActive(item);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "shrink-0 rounded-md px-3 py-1.5 text-sm font-medium",
                        active ? "bg-primary/15 text-primary" : "text-muted-foreground",
                      )}
                    >
                      {item.label}
                      {item.badge != null ? ` (${item.badge})` : ""}
                    </Link>
                  );
                }),
            )}
          </nav>
        </header>

        <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
