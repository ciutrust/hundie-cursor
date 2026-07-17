"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeftRight,
  BookOpen,
  Brain,
  CalendarCheck,
  CheckCircle2,
  ClipboardCheck,
  CreditCard,
  FileSpreadsheet,
  Landmark,
  LayoutGrid,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  PieChart,
  Plane,
  Receipt,
  Settings2,
  ShieldCheck,
  TrendingUp,
  X,
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

const SIDEBAR_COLLAPSED_KEY = "hundie:sidebar-collapsed";

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
  {
    href: "/review/proposals",
    label: "Proposals",
    icon: ClipboardCheck,
    match: (path) => path.startsWith("/review/proposals"),
  },
  {
    href: "/categories",
    label: "Categories",
    icon: BookOpen,
    match: (path) => path.startsWith("/categories"),
  },
];

const FUNCTIONS_ITEMS: NavItem[] = [
  {
    href: "/bills",
    label: "Bills",
    icon: Receipt,
    match: (path) => path.startsWith("/bills"),
  },
  {
    href: "/transactions",
    label: "Transactions",
    icon: CreditCard,
    match: (path) => path.startsWith("/transactions"),
  },
  {
    href: "/expense-reports",
    label: "Expense reports",
    icon: Plane,
    match: (path) => path.startsWith("/expense-reports"),
  },
];

const REPORT_ITEMS: NavItem[] = [
  {
    href: "/month-close",
    label: "Month close",
    icon: CheckCircle2,
    match: (path) => path.startsWith("/month-close"),
  },
  {
    href: "/tax-close",
    label: "Tax close",
    icon: CalendarCheck,
    match: (path) => path.startsWith("/tax-close"),
  },
  {
    href: "/reports",
    label: "Reports & export",
    icon: FileSpreadsheet,
    match: (path) => path === "/reports",
  },
  {
    href: "/reports/spending-by-category",
    label: "Spending by category",
    icon: PieChart,
    match: (path) => path.startsWith("/reports/spending-by-category"),
  },
  {
    href: "/reports/intercompany",
    label: "Intercompany",
    icon: ArrowLeftRight,
    match: (path) => path.startsWith("/reports/intercompany"),
  },
  {
    href: "/reports/income",
    label: "Money in",
    icon: TrendingUp,
    match: (path) => path.startsWith("/reports/income"),
  },
];

const SETUP_ITEMS: NavItem[] = [
  {
    href: "/settings/accounts",
    label: "Accounts",
    icon: Settings2,
    match: (path) => path.startsWith("/settings/accounts"),
  },
  {
    href: "/settings/connections",
    label: "Connections",
    icon: Landmark,
    match: (path) => path.startsWith("/settings/connections"),
  },
  {
    href: "/settings/security",
    label: "Security",
    icon: ShieldCheck,
    match: (path) => path.startsWith("/settings/security"),
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
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const wasOpenRef = useRef(false);

  // Restore the desktop collapse preference (client-only; defaults to expanded on the server).
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1");
    } catch {
      // ignore storage access errors (private mode, etc.)
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((value) => {
      const next = !value;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // While the drawer is open, lock body scroll and close on Escape.
  useEffect(() => {
    if (!mobileOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMobileOpen(false);
    }
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileOpen]);

  // Move focus into the drawer on open; return it to the hamburger when it closes (any path).
  useEffect(() => {
    if (mobileOpen) {
      wasOpenRef.current = true;
      const first = drawerRef.current?.querySelector<HTMLElement>(
        'a[href], button:not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])',
      );
      first?.focus();
    } else if (wasOpenRef.current) {
      wasOpenRef.current = false;
      triggerRef.current?.focus();
    }
  }, [mobileOpen]);

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

  // Shared nav body — rendered in both the fixed desktop sidebar and the mobile drawer so they
  // never drift. `onCollapse` shows the desktop collapse control; `onClose` shows the drawer's X.
  function sidebarBody({
    onCollapse,
    onClose,
  }: {
    onCollapse?: () => void;
    onClose?: () => void;
  }) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-2 border-b border-sidebar-border px-4 py-5">
          <Link href="/review" onClick={onClose} className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
              H
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">Hundie</p>
              <p className="truncate text-xs text-muted-foreground">Multi-entity ledger</p>
            </div>
          </Link>
          {onCollapse ? (
            <button
              type="button"
              onClick={onCollapse}
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          ) : null}
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close menu"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
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
              Functions
            </p>
            <ul className="space-y-0.5">{FUNCTIONS_ITEMS.map(renderNavItem)}</ul>
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
    );
  }

  return (
    <div className="min-h-screen bg-background lg:flex">
      {/* Desktop sidebar (hidden on mobile; hidden on desktop when collapsed) */}
      <aside
        className={cn(
          "hidden print:hidden lg:fixed lg:inset-y-0 lg:z-30 lg:w-60 lg:flex-col lg:border-r lg:border-sidebar-border lg:bg-sidebar",
          collapsed ? "lg:hidden" : "lg:flex",
        )}
      >
        {sidebarBody({ onCollapse: toggleCollapsed })}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label="Close menu"
            tabIndex={-1}
            onClick={() => setMobileOpen(false)}
            className="drawer-backdrop absolute inset-0 h-full w-full cursor-default bg-black/50"
          />
          <aside
            ref={drawerRef}
            className="drawer-panel absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col border-r border-sidebar-border bg-sidebar shadow-xl"
          >
            {sidebarBody({ onClose: () => setMobileOpen(false) })}
          </aside>
        </div>
      ) : null}

      <div className={cn("flex min-h-screen flex-1 flex-col", collapsed ? "lg:pl-0" : "lg:pl-60")}>
        {/* Top bar: always on mobile; on desktop only when the sidebar is collapsed */}
        <header
          className={cn(
            "sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-background/90 px-4 py-3 backdrop-blur-md print:hidden lg:hidden",
            collapsed && "lg:flex",
          )}
        >
          <button
            type="button"
            ref={triggerRef}
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            aria-expanded={mobileOpen}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label="Open sidebar"
            title="Open sidebar"
            className="hidden h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:inline-flex"
          >
            <PanelLeftOpen className="h-5 w-5" />
          </button>
          <Link href="/review" className="text-sm font-semibold">
            Hundie
          </Link>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </header>

        <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
