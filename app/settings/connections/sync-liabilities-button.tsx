"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Scale } from "lucide-react";

type SyncConnection = {
  institution: string | null;
  updated?: unknown[];
  unmatched?: unknown[];
  needsConsent?: boolean;
  error?: string;
};

export function SyncLiabilitiesButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function sync() {
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      const res = await fetch("/api/plaid/liabilities-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Liabilities sync failed");
      const connections = (data.connections ?? []) as SyncConnection[];
      const updated = connections.reduce((sum, item) => sum + (item.updated?.length ?? 0), 0);
      const consent = connections.filter((item) => item.needsConsent);
      setMsg(
        consent.length > 0
          ? `Updated ${updated}. ${consent.map((item) => item.institution ?? "A bank").join(", ")} still need the Liabilities button.`
          : `Updated ${updated} liability balance${updated === 1 ? "" : "s"}.`,
      );
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Liabilities sync failed");
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
        <Scale className="h-4 w-4" />
        {busy ? "Syncing…" : "Sync liabilities"}
      </button>
      {msg ? <p className="text-sm text-muted-foreground">{msg}</p> : null}
      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  );
}
