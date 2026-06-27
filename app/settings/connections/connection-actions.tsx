"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePlaidLink } from "react-plaid-link";

export function ConnectionActions({
  connectionId,
  status,
}: {
  connectionId: string;
  status: string;
}) {
  const router = useRouter();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Update mode keeps the same access token; after re-auth, just sync (which flips status healthy).
  const onSuccess = useCallback(async () => {
    setBusy(true);
    try {
      await fetch("/api/plaid/sync", { method: "POST" });
      router.refresh();
    } finally {
      setBusy(false);
      setLinkToken(null);
    }
  }, [router]);

  const { open, ready } = usePlaidLink({ token: linkToken ?? "", onSuccess });
  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, ready, open]);

  async function reconnect() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/plaid/reconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not start reconnect");
      setLinkToken(data.linkToken);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reconnect failed");
      setBusy(false);
    }
  }

  async function remove() {
    if (
      !window.confirm(
        "Remove this bank connection? Already-imported transactions stay in the ledger; only future syncing stops.",
      )
    ) {
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/plaid/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not remove");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Remove failed");
      setBusy(false);
    }
  }

  const needsAttention = status !== "healthy";

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={reconnect}
        disabled={busy}
        className={
          needsAttention
            ? "rounded-md bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-500/25 disabled:opacity-50 dark:text-amber-400"
            : "rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted/30 disabled:opacity-50"
        }
      >
        {busy ? "…" : "Reconnect"}
      </button>
      <button
        onClick={remove}
        disabled={busy}
        className="rounded-md border border-border px-2.5 py-1 text-xs text-red-600 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
      >
        Remove
      </button>
      {error ? <span className="text-xs text-red-600 dark:text-red-400">{error}</span> : null}
    </div>
  );
}
