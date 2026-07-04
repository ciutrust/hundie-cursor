import Link from "next/link";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { SyncNowButton } from "@/app/settings/connections/sync-now-button";
import type { SyncHealth } from "@/lib/queries/sync-health";

function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/** #5: the review-dashboard sync-health / "since last sync" trust card. Renders nothing when no bank is linked. */
export function SyncHealthCard({ health }: { health: SyncHealth }) {
  if (!health.hasConnections) return null;
  const hasIssues = health.unhealthy.length > 0;

  return (
    <section
      className={`rounded-xl border p-4 shadow-sm ${
        hasIssues ? "border-amber-500/40 bg-amber-500/5" : "border-border bg-card"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          {hasIssues ? (
            <p className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {health.unhealthy.length} bank connection{health.unhealthy.length === 1 ? "" : "s"} need
              attention
            </p>
          ) : (
            <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              Bank sync healthy
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            {health.lastSyncedAt ? `Last synced ${timeAgo(health.lastSyncedAt)}` : "Never synced"}
            {health.recentCount != null
              ? ` · ${health.recentCount.toLocaleString()} imported in the last 7 days`
              : ""}
          </p>
          {hasIssues ? (
            <ul className="mt-1 space-y-0.5 text-xs text-amber-700 dark:text-amber-400">
              {health.unhealthy.map((c, i) => (
                <li key={i}>
                  {c.institution ?? "Bank"} — {c.status.replace(/_/g, " ")}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <SyncNowButton />
          <Link
            href="/settings/connections"
            className="text-sm font-medium text-primary hover:underline"
          >
            Manage →
          </Link>
        </div>
      </div>
    </section>
  );
}
