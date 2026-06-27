"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePlaidLink } from "react-plaid-link";
import type { MappableAccount } from "@/lib/queries/connections";

type PlaidAccount = { plaidAccountId: string; name: string; mask: string | null; type: string };
type ExchangeResult = { connectionId: string; institution: string; accounts: PlaidAccount[] };

// Crude auto-suggest: match the Plaid last-4 to a Hundie account whose name contains it; else leave
// blank for the operator to choose. Operator confirms every mapping regardless.
function suggestAccountId(plaid: PlaidAccount, accounts: MappableAccount[]): string {
  if (plaid.mask) {
    const byMask = accounts.find((a) => a.displayName.includes(plaid.mask as string));
    if (byMask) return byMask.id;
  }
  return "";
}

export function ConnectBank({ accounts }: { accounts: MappableAccount[] }) {
  const router = useRouter();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [exchange, setExchange] = useState<ExchangeResult | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSuccess = useCallback(
    async (publicToken: string) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/plaid/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ publicToken }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Exchange failed");
        setExchange(data);
        const seed: Record<string, string> = {};
        for (const pa of data.accounts as PlaidAccount[]) {
          seed[pa.plaidAccountId] = suggestAccountId(pa, accounts);
        }
        setMapping(seed);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Exchange failed");
      } finally {
        setBusy(false);
        setLinkToken(null);
      }
    },
    [accounts],
  );

  const { open, ready } = usePlaidLink({ token: linkToken ?? "", onSuccess });

  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, ready, open]);

  async function startLink() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/plaid/link-token", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not start Plaid Link");
      setLinkToken(data.linkToken);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start Plaid Link");
    } finally {
      setBusy(false);
    }
  }

  async function saveMapping() {
    if (!exchange) return;
    setBusy(true);
    setError(null);
    try {
      const links = Object.entries(mapping)
        .filter(([, accountId]) => accountId)
        .map(([plaidAccountId, accountId]) => {
          const pa = exchange.accounts.find((a) => a.plaidAccountId === plaidAccountId);
          return {
            plaidAccountId,
            accountId,
            plaidName: pa?.name ?? null,
            plaidMask: pa?.mask ?? null,
            plaidType: pa?.type ?? null,
          };
        });
      const res = await fetch("/api/plaid/map-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId: exchange.connectionId, links }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save mapping");
      setExchange(null);
      setMapping({});
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save mapping");
    } finally {
      setBusy(false);
    }
  }

  if (exchange) {
    return (
      <div className="space-y-4 rounded-xl border border-border bg-card p-4">
        <div>
          <h3 className="font-semibold">Map {exchange.institution} accounts</h3>
          <p className="text-sm text-muted-foreground">
            Pick which Hundie account each Plaid account feeds. Unmapped accounts won&apos;t sync.
          </p>
        </div>
        <div className="space-y-3">
          {exchange.accounts.map((pa) => (
            <div
              key={pa.plaidAccountId}
              className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="text-sm font-medium">
                {pa.name}{" "}
                {pa.mask ? <span className="text-muted-foreground">••{pa.mask}</span> : null}
              </span>
              <select
                value={mapping[pa.plaidAccountId] ?? ""}
                onChange={(e) =>
                  setMapping((m) => ({ ...m, [pa.plaidAccountId]: e.target.value }))
                }
                className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              >
                <option value="">— don&apos;t sync —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.displayName}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
        <div className="flex gap-2">
          <button
            onClick={saveMapping}
            disabled={busy}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save mapping"}
          </button>
          <button
            onClick={() => {
              setExchange(null);
              setMapping({});
            }}
            disabled={busy}
            className="rounded-md border border-border px-3 py-1.5 text-sm"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        onClick={startLink}
        disabled={busy}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {busy ? "Opening…" : "Link a bank"}
      </button>
      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  );
}
