"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getMonthCloseNavCounts } from "@/lib/actions/month-close-nav";
import { cn } from "@/lib/utils";

type MonthCloseEntity = {
  slug: string;
  name: string;
  unclassifiedCount: number;
};

type SidebarMonthCloseNavProps = {
  /** Entity list from the shell — the skeleton shown until this month's counts land. */
  entities: { slug: string; name: string }[];
  /** Current month (YYYY-MM) resolved on the server, so SSR and hydration agree. */
  currentMonth: string;
};

const OPEN_KEY = "hundie:sidebar-month-close-open";

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function shiftMonth(at: string, delta: number) {
  const [year, month] = at.split("-").map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

/** "July" inside the current year, "July 2025" outside it — short enough for a 15rem sidebar. */
function monthLabel(at: string, currentMonth: string) {
  const [year, month] = at.split("-").map(Number);
  const sameYear = at.slice(0, 4) === currentMonth.slice(0, 4);
  return new Date(year, month - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/**
 * Month close section of the sidebar: a month stepper with the per-entity backlog for THAT month
 * underneath, mirroring the Entities section (which counts YTD across all months).
 *
 * The month lives in local state rather than the URL so stepping through months in the nav never
 * navigates the page you're reading; the header link and each entity row carry the chosen month
 * along when you do click through.
 */
export function SidebarMonthCloseNav({ entities, currentMonth }: SidebarMonthCloseNavProps) {
  const pathname = usePathname();
  const active = pathname.startsWith("/month-close");

  const [open, setOpen] = useState(active);
  const [at, setAt] = useState(currentMonth);
  const [counts, setCounts] = useState<MonthCloseEntity[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Restore the open preference (client-only, so the server render stays deterministic).
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(OPEN_KEY);
      if (stored != null) setOpen(stored === "1" || active);
    } catch {
      // ignore storage access errors (private mode, etc.)
    }
    // `active` is read once on mount: being on /month-close forces the section open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleOpen() {
    setOpen((value) => {
      const next = !value;
      try {
        window.localStorage.setItem(OPEN_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }

  // Counts load only while the section is open, and reload when the month changes. Keeping the
  // previous month's numbers on screen (dimmed) while the next month loads makes stepping feel
  // instant instead of blanking the list on every click.
  const requestRef = useRef(0);
  useEffect(() => {
    if (!open) return;
    const requestId = ++requestRef.current;
    setLoading(true);
    getMonthCloseNavCounts(at)
      .then((result) => {
        if (requestRef.current !== requestId) return;
        setCounts(result.entities);
        setError(result.error);
        setLoading(false);
      })
      .catch(() => {
        if (requestRef.current !== requestId) return;
        setError("Counts unavailable");
        setLoading(false);
      });
  }, [open, at]);

  const rows: MonthCloseEntity[] =
    counts ?? entities.map((entity) => ({ ...entity, unclassifiedCount: -1 }));
  const loaded = counts != null;
  const total = loaded ? counts.reduce((sum, row) => sum + row.unclassifiedCount, 0) : null;

  return (
    <div>
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={toggleOpen}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-expanded={open}
          aria-label={open ? "Collapse month close" : "Expand month close"}
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <Link
          href={`/month-close?at=${at}`}
          className={cn(
            "flex flex-1 items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium transition-colors",
            active
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span className="flex-1">Month close</span>
          {total != null && total > 0 ? (
            <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-amber-700 dark:text-amber-400">
              {total}
            </span>
          ) : null}
        </Link>
      </div>

      {open ? (
        <div className="ml-4 mt-0.5 space-y-0.5 border-l border-border pl-2">
          {/* Month stepper — changes the counts below without navigating away from this page. */}
          <div className="flex items-center gap-1 px-1 py-1">
            <button
              type="button"
              onClick={() => setAt((value) => shiftMonth(value, -1))}
              aria-label="Previous month"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="flex-1 text-center text-xs font-semibold tabular-nums">
              {monthLabel(at, currentMonth)}
            </span>
            <button
              type="button"
              onClick={() => setAt((value) => shiftMonth(value, 1))}
              aria-label="Next month"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {error ? (
            <p className="px-2 py-1.5 text-xs text-destructive">{error}</p>
          ) : (
            <ul className={cn("space-y-0.5 transition-opacity", loading && "opacity-50")}>
              {rows.map((row) => {
                const href = `/review/${row.slug}?period=month&at=${at}`;
                const clear = loaded && row.unclassifiedCount === 0;
                return (
                  <li key={row.slug}>
                    <Link
                      href={href}
                      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <span className="flex-1 truncate">{row.name.split(",")[0]}</span>
                      {clear ? (
                        <CheckCircle2
                          className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
                          aria-label="Nothing left to categorize"
                        />
                      ) : row.unclassifiedCount > 0 ? (
                        <span className="rounded-full bg-destructive/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-destructive">
                          {row.unclassifiedCount}
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground/60">…</span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
