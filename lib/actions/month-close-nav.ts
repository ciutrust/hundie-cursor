"use server";

import { requireUser } from "@/lib/auth/require-user";
import { periodRangeFor } from "@/lib/period";
import { getSidebarEntityNav, type SidebarEntityNavItem } from "@/lib/queries/entity-home";

const MONTH_PATTERN = /^\d{4}-\d{2}$/;

export type MonthCloseNavResult = {
  at: string;
  entities: SidebarEntityNavItem[];
  error: string | null;
};

/**
 * Per-entity review backlog for ONE calendar month — powers the sidebar's Month close stepper.
 *
 * Same counting rule as the Entities nav (null category OR "Ask My Accountant", excluding
 * Plaid-reversed rows and resolved split parents), just windowed to the month instead of YTD, so
 * the two sections never disagree about what "left to categorize" means.
 *
 * Deliberately lazy: the shell does NOT prefetch these on every page render — that would double
 * the sidebar's count fan-out. The nav calls this when the section is open.
 */
export async function getMonthCloseNavCounts(at: string): Promise<MonthCloseNavResult> {
  const { error: authError } = await requireUser();
  if (authError) return { at, entities: [], error: authError };
  if (!MONTH_PATTERN.test(at)) return { at, entities: [], error: "Invalid month" };

  try {
    const entities = await getSidebarEntityNav(periodRangeFor("month", at));
    return { at, entities, error: null };
  } catch (cause) {
    console.error("Month close nav counts failed:", cause);
    return { at, entities: [], error: "Counts unavailable" };
  }
}
