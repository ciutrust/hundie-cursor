import { Landmark } from "lucide-react";
import { keyFingerprint } from "@/lib/crypto/secret-box";
import { getConnections, getMappableAccounts, type ConnectionView } from "@/lib/queries/connections";
import { ConnectBank } from "./connect-bank";
import { ConnectionActions } from "./connection-actions";
import { SyncNowButton } from "./sync-now-button";

const STATUS_STYLES: Record<string, string> = {
  healthy: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  needs_reauth: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  error: "bg-red-500/15 text-red-700 dark:text-red-400",
};

export default async function ConnectionsPage() {
  let connections: ConnectionView[] = [];
  let configError = false;
  try {
    connections = await getConnections();
  } catch {
    configError = true;
  }
  const accounts = await getMappableAccounts();

  let encFingerprint: string | null = null;
  try {
    encFingerprint = keyFingerprint();
  } catch {
    encFingerprint = null;
  }

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Setup · Connections
        </p>
        <div className="flex items-center gap-2">
          <Landmark className="h-5 w-5 text-primary" />
          <h1 className="text-3xl font-semibold tracking-tight">Bank connections</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Link a bank once, map its accounts to your Hundie accounts, then pull transactions with
          Sync now — no more CSV downloads. Tokens are encrypted; nothing is stored in the browser.
        </p>
      </div>

      {configError ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm">
          Bank sync needs server configuration (<code>SUPABASE_SERVICE_ROLE_KEY</code>,{" "}
          <code>PLAID_*</code>, <code>PLAID_TOKEN_ENC_KEY</code>). Add them to the environment to
          enable Connections.
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <ConnectBank accounts={accounts} />
        {connections.length > 0 ? <SyncNowButton /> : null}
      </div>

      {connections.length === 0 ? (
        <p className="text-sm text-muted-foreground">No banks linked yet.</p>
      ) : (
        <div className="space-y-4">
          {connections.map((c) => (
            <div key={c.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="font-semibold">{c.institution ?? "Bank"}</h2>
                <div className="flex flex-wrap items-center gap-3">
                  {c.lastSyncedAt ? (
                    <span className="text-xs text-muted-foreground">
                      Synced {new Date(c.lastSyncedAt).toLocaleString()}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">Never synced</span>
                  )}
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      STATUS_STYLES[c.status] ?? "bg-muted text-muted-foreground"
                    }`}
                  >
                    {c.status.replace("_", " ")}
                  </span>
                  <ConnectionActions connectionId={c.id} status={c.status} />
                </div>
              </div>
              {c.status === "needs_reauth" ? (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                  Your bank needs you to re-authenticate. Click <strong>Reconnect</strong> — your
                  mappings and history are kept.
                </p>
              ) : null}
              <div className="mt-3 divide-y divide-border border-t border-border">
                {c.links.length === 0 ? (
                  <p className="pt-3 text-sm text-muted-foreground">
                    No accounts mapped — re-link to map them.
                  </p>
                ) : (
                  c.links.map((l) => (
                    <div
                      key={l.plaidAccountId}
                      className="flex items-center justify-between gap-3 py-2 text-sm"
                    >
                      <span>
                        {l.plaidName ?? "Account"}{" "}
                        {l.plaidMask ? (
                          <span className="text-muted-foreground">••{l.plaidMask}</span>
                        ) : null}
                      </span>
                      <span className="text-muted-foreground">→ {l.accountName ?? "—"}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {encFingerprint ? (
        <p className="text-xs text-muted-foreground">
          Encryption-key fingerprint <code className="font-mono">{encFingerprint}</code> — record
          this. If it ever changes, saved tokens can&apos;t be decrypted and banks must be removed
          and re-linked.
        </p>
      ) : null}
    </div>
  );
}
