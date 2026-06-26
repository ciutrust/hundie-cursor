"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Brain,
  CheckCircle2,
  FileSpreadsheet,
  LayoutGrid,
  Settings2,
} from "lucide-react";
import { SidebarEntitiesNav } from "@/components/layout/sidebar-entities-nav";
import { signOut } from "@/lib/actions/reclassify";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { cn } from "@/lib/utils";

type EntityNavItem = {
  slug: string;
  name: string;
  unclassifiedCount?: number;
};

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  match: (path: string) => boolean;
  badge?: number;
  disabled?: boolean;
};

type AppShellProps = {
  children: React.ReactNode;
  entities: EntityNavItem[];
  aiAwaitingCount: number;
  userLabel: string;
  userInitials: string;
};

const CLASSIFY_ITEMS: NavItem[] = [
  {
    href: "/review",
    label: "Dashboard",
    icon: LayoutGrid,
    match: (path) => path === "/review",
  },
  {
    href: "/review/ai",
    label: "AI review",
    icon: Brain,
    match: (path) => path === "/review/ai" || path.startsWith("/review/ai/"),
  },
];

const REPORT_ITEMS: NavItem[] = [
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
];

const SETUP_ITEMS: NavItem[] = [
  {
    href: "/settings/accounts",
    label: "Accounts",
    icon: Settings2,
    match: (path) => path.startsWith("/settings"),
  },
];

export function AppShell({
  children,
  entities,
  aiAwaitingCount,
  userLabel,
  userInitials,
}: AppShellProps) {
  const pathname = usePathname();

  function renderNavItem(item: NavItem) {
    const active = item.match(pathname);
    const Icon = item.icon;
    const badge = item.href === "/review/ai" && aiAwaitingCount > 0 ? aiAwaitingCount : item.badge;

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
          {badge != null && badge > 0 ? (
            <span className="rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-violet-600 dark:text-violet-400">
              {badge}
            </span>
          ) : null}
        </Link>
      </li>
    );
  }

  const mobileLinks = [
    ...CLASSIFY_ITEMS,
    { href: "/review/entities", label: "Entities" },
    ...REPORT_ITEMS.filter((i) => !i.disabled),
  ];

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
            <div>
              <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Classify
              </p>
              <ul className="space-y-0.5">{CLASSIFY_ITEMS.map(renderNavItem)}</ul>
            </div>

            <div>
              <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Entities
              </p>
              <SidebarEntitiesNav entities={entities} />
            </div>

            <div>
              <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Tax readiness
              </p>
              <ul className="space-y-0.5">{REPORT_ITEMS.map(renderNavItem)}</ul>
            </div>

            <div>
              <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Setup
              </p>
              <ul className="space-y-0.5">{SETUP_ITEMS.map(renderNavItem)}</ul>
            </div>
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
            {mobileLinks.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "shrink-0 rounded-md px-3 py-1.5 text-sm font-medium",
                  pathname === item.href || pathname.startsWith(`${item.href}/`)
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </header>

        <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
