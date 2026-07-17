"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Camera, CreditCard, Plane } from "lucide-react";
import { cn } from "@/lib/utils";

type BottomNavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  match: (path: string) => boolean;
};

// Only the three essentials live down here. The hamburger drawer still carries the full nav,
// so this bar stays thumb-sized instead of turning into a second sidebar.
const TRANSACTIONS: BottomNavItem = {
  href: "/transactions",
  label: "Transactions",
  icon: CreditCard,
  match: (path) => path.startsWith("/transactions"),
};

const EXPENSE_REPORTS: BottomNavItem = {
  href: "/expense-reports",
  label: "Expense reports",
  icon: Plane,
  match: (path) => path.startsWith("/expense-reports"),
};

function SideLink({ item, active }: { item: BottomNavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-16 flex-col items-center justify-center gap-1 transition-colors",
        active ? "text-primary" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="h-5 w-5 shrink-0" />
      <span className="whitespace-nowrap text-[10px] font-medium">{item.label}</span>
    </Link>
  );
}

/**
 * Mobile-only bottom bar. Hidden at `lg` and up, which is exactly where the desktop sidebar
 * takes over, so one primary nav is always on screen and never both.
 */
export function BottomNav() {
  const pathname = usePathname();
  const captureActive = pathname.startsWith("/capture");

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] print:hidden lg:hidden"
    >
      <ul className="flex items-stretch">
        <li className="flex-1">
          <SideLink item={TRANSACTIONS} active={TRANSACTIONS.match(pathname)} />
        </li>

        {/* Capture is the whole point of the phone: receipt in hand, charge lands days later. */}
        <li className="flex-1">
          <Link
            href="/capture"
            aria-current={captureActive ? "page" : undefined}
            className="flex h-16 flex-col items-center justify-center gap-1"
          >
            <span
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-transform active:scale-95",
                captureActive && "ring-2 ring-ring ring-offset-2 ring-offset-card",
              )}
            >
              <Camera className="h-5 w-5" />
            </span>
            <span className="whitespace-nowrap text-[10px] font-semibold text-primary">Capture</span>
          </Link>
        </li>

        <li className="flex-1">
          <SideLink item={EXPENSE_REPORTS} active={EXPENSE_REPORTS.match(pathname)} />
        </li>
      </ul>
    </nav>
  );
}
