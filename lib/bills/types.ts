// Row-shape boundary types for the bills tables. These aren't in the generated Supabase types
// (no CLI to regen), so they're hand-written and asserted at the query boundary — the same approach
// lib/queries/proposals.ts uses for classification_proposals.

import type { Cadence } from "./cadence";
import type { InstanceStatus } from "./state";

export type BillStatus = "active" | "paused" | "archived";

export type Bill = {
  id: string;
  entity_id: string;
  name: string;
  expected_amount: number | null;
  amount_varies: boolean;
  cadence: Cadence;
  due_day: number | null;
  anchor_date: string | null;
  portal_url: string | null;
  login_hint: string | null;
  match_hint: string | null;
  category_id: string | null;
  status: BillStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type BillInstance = {
  id: string;
  bill_id: string;
  entity_id: string;
  due_date: string;
  expected_amount: number | null;
  status: InstanceStatus;
  paid_at: string | null;
  paid_amount: number | null;
  matched_transaction_id: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Coerce a Supabase numeric column to a number (or null). PostgREST serializes Postgres `numeric` as
 * a JSON STRING, so `expected_amount` / `paid_amount` arrive as strings at runtime even though the
 * hand-written row types say `number | null`. Summing those with `+=` would string-concatenate and
 * render `$NaN` — every amount read must pass through here first (mirrors the `Number(...)` coercion
 * the rest of the app applies to `transactions.amount`).
 */
export function numOrNull(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** A day-window (± days) around the due date to look for a matching charge, widened for long cadences. */
export function dateWindowForCadence(cadence: Cadence): number {
  switch (cadence) {
    case "weekly":
      return 3;
    case "monthly":
      return 7;
    case "quarterly":
      return 12;
    case "semiannual":
      return 15;
    case "annual":
      return 20;
    default:
      return 7;
  }
}
