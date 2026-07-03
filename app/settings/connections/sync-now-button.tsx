"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

export function SyncNowButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function sync() {
    setBusy(true);
    setMsg(null);
    setWarnings([]);
    setError(null);
    try {
      const res = await fetch("/api/plaid/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Sync failed");
      setMsg(`Synced — ${data.inserted} new, ${data.skipped} already imported.`);
      // Surface per-connection problems (e.g. C2 needs_mapping: named unmapped accounts / held
      // cursor) so the operator can act instead of the failure being buried in the aggregate.
      type ConnResult = { institution: string | null; status: string; error?: string };
      const connWarnings = ((data.connections ?? []) as ConnResult[])
        .filter((c) => c.error || (c.status !== "healthy" && c.status !== "needs_reauth"))
        .map((c) => `${c.institution ?? "Connection"}: ${c.error ?? c.status}`);
      setWarnings(connWarnings);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <button
        onClick={sync}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-muted/30 disabled:opacity-50"
      >
        <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
        {busy ? "Syncing…" : "Sync now"}
      </button>
      {msg ? <p className="text-sm text-emerald-600 dark:text-emerald-400">{msg}</p> : null}
      {warnings.length > 0
        ? warnings.map((w, i) => (
            <p key={i} className="text-sm text-amber-600 dark:text-amber-400">
              {w}
            </p>
          ))
        : null}
      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  );
}
