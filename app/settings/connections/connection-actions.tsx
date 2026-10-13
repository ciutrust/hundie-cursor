"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePlaidLink } from "react-plaid-link";

type LinkMode = "reconnect" | "liabilities";

type SyncConnection = {
  updated?: { name: string }[];
  unmatched?: { name: string; mask: string | null; institution: string }[];
  needsConsent?: boolean;
  error?: string;
};

function summary(data: { connections?: SyncConnection[] }): string {
  const connections = data.connections ?? [];
  const updated = connections.reduce((sum, item) => sum + (item.updated?.length ?? 0), 0);
  const unmatched = connections.flatMap((item) => item.unmatched ?? []);
  const errors = connections.filter((item) => item.error && !item.needsConsent);
  const parts = [`Updated ${updated}`];
  if (unmatched.length > 0) {
    const names = unmatched
      .slice(0, 3)
      .map((item) => `${item.institution} ${item.name}${item.mask ? ` ••${item.mask}` : ""}`)
      .join(", ");
    parts.push(`${unmatched.length} unmatched (${names})`);
  }
  if (errors.length > 0) parts.push(errors[0]?.error ?? "Sync error");
  return parts.join(". ") + ".";
}

export function ConnectionActions({
  connectionId,
  status,
}: {
  connectionId: string;
  status: string;
}) {
  const router = useRouter();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [mode, setMode] = useState<LinkMode>("reconnect");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const onSuccess = useCallback(async () => {
    setBusy(true);
    try {
      if (mode === "liabilities") {
        const res = await fetch("/api/plaid/liabilities-sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ connectionId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Liabilities sync failed");
        setNotice(summary(data));
        setError(null);
      } else {
        await fetch("/api/plaid/sync", { method: "POST" });
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setBusy(false);
      setLinkToken(null);
    }
  }, [connectionId, mode, router]);

  const { open, ready } = usePlaidLink({
    token: linkToken ?? "",
    onSuccess,
    onExit: () => {
      setBusy(false);
      setLinkToken(null);
    },
  });
  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, ready, open]);

  async function reconnect() {
    setError(null);
    setNotice(null);
    setMode("reconnect");
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

  async function openLiabilitiesConsent() {
    const res = await fetch("/api/plaid/liabilities-consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectionId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Could not start liabilities consent");
    setMode("liabilities");
    setLinkToken(data.linkToken);
  }

  async function liabilities() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const res = await fetch("/api/plaid/liabilities-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Liabilities sync failed");
      if (data.needsConsent) {
        await openLiabilitiesConsent();
        return;
      }
      setNotice(summary(data));
      router.refresh();
      setBusy(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Liabilities sync failed");
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
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={liabilities}
        disabled={busy}
        className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted/30 disabled:opacity-50"
      >
        {busy ? "…" : "Liabilities"}
      </button>
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
      {notice ? <span className="text-xs text-muted-foreground">{notice}</span> : null}
      {error ? <span className="text-xs text-red-600 dark:text-red-400">{error}</span> : null}
    </div>
  );
}
