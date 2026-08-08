import { Landmark } from "lucide-react";
import { keyFingerprint } from "@/lib/crypto/secret-box";
import { getConnections, getMappableAccounts, type ConnectionView } from "@/lib/queries/connections";
import { getClassifiableEntities } from "@/lib/queries/review";
import { ConnectBank } from "./connect-bank";
import { ConnectionActions } from "./connection-actions";
import { MapAccountsPanel } from "./map-accounts-panel";
import { SyncNowButton } from "./sync-now-button";

const STATUS_STYLES: Record<string, string> = {
  healthy: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  needs_reauth: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  needs_mapping: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
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
  const [accounts, entities] = await Promise.all([
    getMappableAccounts(),
    getClassifiableEntities(),
  ]);

  // plaid_account_links has unique(account_id), so an account linked to any connection can never
  // back a second Plaid account. Offering one would guarantee a failed save, so keep them out of
  // the mapping panel entirely — that is why the panel creates ledger accounts inline.
  const linkedAccountIds = new Set(connections.flatMap((c) => c.links.map((l) => l.accountId)));
  const unlinkedAccounts = accounts.filter((a) => !linkedAccountIds.has(a.id));

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
                  {c.syncFromDate ? (
                    <span
                      className="text-xs text-muted-foreground"
                      title="Plaid pulls transactions on/after this cutover date. Earlier history comes from the CSV import — the two never overlap."
                    >
                      Pulling since {new Date(`${c.syncFromDate}T00:00:00`).toLocaleDateString()}
                    </span>
                  ) : null}
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
              {c.status === "needs_mapping" ? (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                  Some accounts at this bank have no decision on them yet, so this connection is
                  holding its place in your history until they do. Not every account has to be
                  mapped — click <strong>Map accounts</strong> and settle each one, either by
                  pointing it at a Hundie account or by marking it{" "}
                  <strong>Don&apos;t track this account</strong> if it should never be in the
                  ledger. Then <strong>Sync now</strong> — the flag clears on the next sync, not
                  when you save. Accounts already mapped keep importing normally.
                </p>
              ) : null}
              <div className="mt-3 divide-y divide-border border-t border-border">
                {c.links.length === 0 ? (
                  // Zero links no longer means zero decisions — every account here may be marked
                  // "don't track". This list is links-only, so point at the panel rather than
                  // asserting nothing has been settled.
                  <p className="pt-3 text-sm text-muted-foreground">
                    No accounts from this bank feed a Hundie account. Use{" "}
                    <strong>Map accounts</strong> below — that&apos;s also where accounts marked not
                    tracked are listed.
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
              {c.ignored.length > 0 ? (
                // Standing record of what is deliberately out of scope. Once these are marked the
                // connection reads 'healthy', so without this the excluded accounts would be
                // invisible outside the panel — and which bank accounts are out of scope is
                // material to anyone reading the books.
                <div className="mt-3 border-t border-border pt-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Not tracked ({c.ignored.length})
                  </p>
                  <div className="mt-1 space-y-1">
                    {c.ignored.map((ig) => (
                      <div
                        key={ig.plaidAccountId}
                        className="flex items-center justify-between gap-3 text-sm text-muted-foreground"
                      >
                        <span>
                          {ig.plaidName ?? "Account"}
                          {ig.plaidMask && !(ig.plaidName ?? "").includes(ig.plaidMask)
                            ? ` ••${ig.plaidMask}`
                            : ""}
                        </span>
                        <span className="text-xs">{ig.reason ?? "never imported"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              <MapAccountsPanel
                connectionId={c.id}
                institution={c.institution}
                mappableAccounts={unlinkedAccounts}
                entities={entities}
              />
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
