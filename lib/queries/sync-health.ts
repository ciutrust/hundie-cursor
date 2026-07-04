import { getConnections, type ConnectionView } from "@/lib/queries/connections";
import { createClient } from "@/lib/supabase/server";

/**
 * #5 — "Since last sync" trust card. Surfaces two things the review dashboard is blind to today:
 * (1) a bank connection that has gone unhealthy (needs_reauth / error) — invisible outside Settings,
 * so a silently-stalled feed looks like "nothing new" instead of "broken"; and (2) how fresh the feed
 * is (last sync + how many transactions landed recently). Everything is fail-soft: any read error
 * hides the card rather than breaking the dashboard.
 */
export type SyncHealth = {
  hasConnections: boolean;
  unhealthy: { institution: string | null; status: string }[];
  lastSyncedAt: string | null;
  /** Transactions created in the last 7 days (null when unknown / read failed). */
  recentCount: number | null;
};

/** Pure: fold the connection list into the unhealthy set + the most-recent sync timestamp. */
export function summarizeConnections(connections: ConnectionView[]): {
  unhealthy: { institution: string | null; status: string }[];
  lastSyncedAt: string | null;
} {
  const unhealthy = connections
    .filter((c) => c.status !== "healthy")
    .map((c) => ({ institution: c.institution, status: c.status }));

  let lastSyncedAt: string | null = null;
  for (const c of connections) {
    // ISO-8601 timestamps compare correctly as strings.
    if (c.lastSyncedAt && (lastSyncedAt === null || c.lastSyncedAt > lastSyncedAt)) {
      lastSyncedAt = c.lastSyncedAt;
    }
  }
  return { unhealthy, lastSyncedAt };
}

const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export async function getSyncHealth(): Promise<SyncHealth> {
  let connections: ConnectionView[] = [];
  try {
    connections = await getConnections();
  } catch {
    // Service-role / Plaid not configured — no connections to report on; hide the card.
    connections = [];
  }

  if (connections.length === 0) {
    return { hasConnections: false, unhealthy: [], lastSyncedAt: null, recentCount: null };
  }

  const { unhealthy, lastSyncedAt } = summarizeConnections(connections);

  // Count transactions imported in the last 7 days as a "your feed is live" freshness signal. A HEAD
  // count (no rows) — deliberately a fixed window rather than strictly `created_at >= last_synced_at`,
  // which is brittle (rows are inserted just before last_synced_at is bumped, so the strict form can
  // read 0 right after a real sync). Fail-soft to null.
  let recentCount: number | null = null;
  try {
    const supabase = await createClient();
    const since = new Date(Date.now() - RECENT_WINDOW_MS).toISOString();
    const { count, error } = await supabase
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .is("plaid_removed_at", null)
      .gte("created_at", since);
    if (!error) recentCount = count ?? 0;
  } catch {
    recentCount = null;
  }

  return { hasConnections: true, unhealthy, lastSyncedAt, recentCount };
}
