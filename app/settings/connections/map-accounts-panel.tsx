"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { MappableAccount } from "@/lib/queries/connections";

type ConnectionAccount = {
  plaidAccountId: string;
  name: string;
  mask: string | null;
  type: string;
  mappedAccountId: string | null;
  mappedAccountName: string | null;
  // A saved "don't track this" decision (plaid_ignored_accounts). Mapped and ignored are meant to
  // be mutually exclusive: /api/plaid/ignore-accounts 409s an account that already has a link, and
  // save() below un-ignores before it maps. Nothing enforces it from the map side, so the grouping
  // below treats a link as the stronger fact rather than trusting the invariant.
  ignored: boolean;
};

type AccountTypeValue = "credit_card" | "checking" | "savings";
type RowMode = "skip" | "existing" | "create" | "ignore";

type RowState = {
  mode: RowMode;
  accountId: string;
  displayName: string;
  entityId: string;
  accountType: AccountTypeValue;
  reason: string;
};

const ACCOUNT_TYPE_LABELS: Record<AccountTypeValue, string> = {
  credit_card: "Credit card",
  checking: "Checking",
  savings: "Savings",
};

// Some institutions (Wells Fargo) already end the account name with the mask — "BUSINESS CHECKING
// ...1622" — so rendering ••1622 next to it repeats the digits. Only show the badge when the name
// doesn't already carry them.
function showMask(pa: { name: string; mask: string | null }): boolean {
  return Boolean(pa.mask) && !pa.name.includes(pa.mask as string);
}

// Existing accounts read "WF GBSL Checking", not "BUSINESS CHECKING ...1622". Title-case the Plaid
// name and drop its "..." mask marker so the prefill is closer to the ledger's convention; the
// operator still owns the final name (it's what the CPA reports group by).
function suggestDisplayName(pa: { name: string; mask: string | null }): string {
  const base = pa.name
    .replace(/\.{2,}\s*\d+\s*$/, "")
    .replace(/[®™]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());
  return pa.mask ? `${base} ${pa.mask}` : base;
}

// Plaid's type is the narrowed 3-value union (credit/depository/other) — it can't tell checking from
// savings, so fall back to the account name for that split. The operator can override either way.
function suggestAccountType(pa: ConnectionAccount): AccountTypeValue {
  if (pa.type === "credit") return "credit_card";
  if (/saving/i.test(pa.name)) return "savings";
  return "checking";
}

// Seeded accounts use snake_case issuer keys ("wells_fargo", "capital_one"), so derive the same
// shape from the institution name. Fall back to "plaid" when the institution is unknown — no CSV
// parser is registered for it either way.
function issuerParserFrom(institution: string | null): string {
  const key = (institution ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return key || "plaid";
}

// Default to skip: nothing gets created, linked, or marked untracked until the operator says so.
function defaultRow(pa: ConnectionAccount): RowState {
  return {
    mode: "skip",
    accountId: "",
    displayName: suggestDisplayName(pa),
    entityId: "",
    accountType: suggestAccountType(pa),
    reason: "",
  };
}

/**
 * Map the Plaid accounts of an ALREADY-LINKED connection, or mark one as deliberately not tracked.
 * Without this, a connection stuck at needs_mapping could only be fixed by re-running Plaid Link.
 * Every active Hundie account is already spoken for (unique account_id), so creating a ledger
 * account inline is the normal path — and for accounts that will never belong in the ledger,
 * "don't track" is the path that releases the held sync cursor.
 */
export function MapAccountsPanel({
  connectionId,
  institution,
  mappableAccounts,
  entities,
}: {
  connectionId: string;
  institution: string | null;
  mappableAccounts: MappableAccount[];
  entities: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState<ConnectionAccount[]>([]);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  // Saved ignores the operator asked to undo this session. Staged, not sent until Save.
  const [trackAgain, setTrackAgain] = useState<Set<string>>(new Set());
  // Accounts created during this session — kept locally so a retry after a failed map call reuses
  // them instead of creating duplicates (the server-rendered list is stale until router.refresh()).
  const [createdAccounts, setCreatedAccounts] = useState<MappableAccount[]>([]);
  const [liveInstitution, setLiveInstitution] = useState<string | null>(institution);
  const [cutoverDate, setCutoverDate] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const issuerParser = issuerParserFrom(liveInstitution);
  // Links only — an ignored account must never count as "mapped" here, or isFirstMapping below
  // would read a connection whose accounts were all ignored as already-mapped and strand its
  // cutover.
  const mapped = accounts.filter((a) => a.mappedAccountId);
  // Saved ignores get their own group, unless the operator asked to track one again — then it drops
  // into the decision list so it can be mapped in the same save. The mappedAccountId check keeps the
  // three groups disjoint: an account that somehow carried both a link and a stale ignore row would
  // otherwise render twice, and reading "not tracked" next to an account that IS importing is worse
  // than not seeing the stale row at all.
  const notTracked = accounts.filter(
    (a) => a.ignored && !a.mappedAccountId && !trackAgain.has(a.plaidAccountId),
  );
  const needsDecision = accounts.filter(
    (a) => !a.mappedAccountId && (!a.ignored || trackAgain.has(a.plaidAccountId)),
  );

  // Derived once so the Save button and save() can never disagree about what is staged.
  const toMap = needsDecision.filter((pa) => {
    const mode = rows[pa.plaidAccountId]?.mode;
    return mode === "existing" || mode === "create";
  });
  const toIgnore = needsDecision.filter(
    (pa) => rows[pa.plaidAccountId]?.mode === "ignore" && !pa.ignored,
  );
  // A saved ignore the operator un-ignored and then set back to "don't track" is a round trip:
  // send neither side, or the API would delete and re-create the same row in one request.
  const toUnignore = [...trackAgain].filter((id) => rows[id]?.mode !== "ignore");
  const actionable = toMap.length > 0 || toIgnore.length > 0 || toUnignore.length > 0;

  // Zero links = this connection has never been mapped, so its sync_from_date is still the
  // link-day default. That's the ONE case where the cutover is ours to set (map-accounts persists
  // it only on a first-ever mapping); leaving it blank would silently strand pre-link history.
  // Only ask when a mapping is actually staged — an ignore-only save never calls map-accounts, so a
  // date typed here would be silently dropped.
  const isFirstMapping = accounts.length > 0 && mapped.length === 0;

  const alreadyLinkedIds = new Set(
    accounts.map((a) => a.mappedAccountId).filter((id): id is string => Boolean(id)),
  );

  // Hide accounts another row already claims: unique(account_id) means one Hundie account can back
  // only one Plaid account, and catching it here beats a 500 after ledger accounts were created.
  function optionsFor(plaidAccountId: string): MappableAccount[] {
    const takenElsewhere = new Set(
      Object.entries(rows)
        .filter(([key, r]) => key !== plaidAccountId && r.mode === "existing" && r.accountId)
        .map(([, r]) => r.accountId),
    );
    return [...mappableAccounts, ...createdAccounts].filter(
      (a) => !alreadyLinkedIds.has(a.id) && !takenElsewhere.has(a.id),
    );
  }

  function setRow(plaidAccountId: string, patch: Partial<RowState>) {
    setRows((r) => ({ ...r, [plaidAccountId]: { ...r[plaidAccountId], ...patch } }));
  }

  function startTrackingAgain(pa: ConnectionAccount) {
    setError(null);
    setTrackAgain((s) => new Set(s).add(pa.plaidAccountId));
    setRows((r) => (r[pa.plaidAccountId] ? r : { ...r, [pa.plaidAccountId]: defaultRow(pa) }));
  }

  async function loadAccounts() {
    setBusy(true);
    setError(null);
    setSavedMsg(null);
    try {
      const res = await fetch("/api/plaid/connection-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load accounts from Plaid");
      const list = data.accounts as ConnectionAccount[];
      const seed: Record<string, RowState> = {};
      // Seed every unmapped account, ignored ones included — an ignored account needs a row waiting
      // the moment the operator clicks "Track this account again".
      for (const pa of list) {
        if (pa.mappedAccountId) continue;
        seed[pa.plaidAccountId] = defaultRow(pa);
      }
      setAccounts(list);
      setRows(seed);
      setTrackAgain(new Set());
      setLiveInstitution(data.institution ?? institution);
      setOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load accounts from Plaid");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setOpen(false);
    setAccounts([]);
    setRows({});
    setTrackAgain(new Set());
    setCreatedAccounts([]);
    setCutoverDate("");
    setError(null);
  }

  function cancel() {
    const created = createdAccounts.length > 0;
    reset();
    // Anything created this session is real on the server; refresh so the page (and the next open
    // of this panel) sees it instead of offering to create it again.
    if (created) router.refresh();
  }

  async function save() {
    if (!actionable) {
      setError("Nothing to save — every account is still set to “decide later”.");
      return;
    }

    // Validate everything up front: a half-filled row must not create ledger accounts and then fail.
    for (const pa of toMap) {
      const row = rows[pa.plaidAccountId];
      if (row.mode === "existing" && !row.accountId) {
        setError(`Pick a Hundie account for ${pa.name}, or set it to decide later.`);
        return;
      }
      if (row.mode === "create") {
        if (!row.displayName.trim()) {
          setError(`Give the new account for ${pa.name} a name.`);
          return;
        }
        if (!row.entityId) {
          setError(
            `Choose an entity for ${pa.name}. Entity decides tax treatment, so Hundie never picks one for you.`,
          );
          return;
        }
      }
    }

    setBusy(true);
    setError(null);
    const links: {
      plaidAccountId: string;
      accountId: string;
      plaidName: string | null;
      plaidMask: string | null;
      plaidType: string | null;
    }[] = [];
    const createdNames: string[] = [];
    // Steps that already landed, so a later failure can say so instead of implying nothing happened.
    const landed: string[] = [];
    let untracked = 0;
    let retracked = 0;
    try {
      // Not-tracked changes go FIRST. Two reasons: an un-ignore must delete its row before a link is
      // written for the same account (nothing is ever both linked and ignored), and this call
      // creates nothing — if it fails, there are no orphan ledger accounts to clean up.
      if (toIgnore.length > 0 || toUnignore.length > 0) {
        const res = await fetch("/api/plaid/ignore-accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            connectionId,
            ignore: toIgnore.map((pa) => ({
              plaidAccountId: pa.plaidAccountId,
              plaidName: pa.name,
              plaidMask: pa.mask,
              plaidType: pa.type,
              reason: rows[pa.plaidAccountId]?.reason.trim() || null,
            })),
            unignore: toUnignore,
          }),
        });
        const data = await res.json();
        // The route un-ignores before it ignores and reports how many rows it actually deleted, so
        // even its failure body can carry work that landed. Count what the server says, not what we
        // asked for.
        untracked = typeof data.ignored === "number" ? data.ignored : 0;
        retracked = typeof data.unignored === "number" ? data.unignored : 0;
        if (retracked > 0) {
          landed.push(`${retracked} account${retracked === 1 ? " is" : "s are"} tracked again`);
        }
        if (!res.ok) throw new Error(data.error ?? "Could not save the not-tracked accounts");
        if (untracked > 0) {
          landed.push(`${untracked} account${untracked === 1 ? " is" : "s are"} marked not tracked`);
        }
        // Fold the result into local state so a retry after a later failure doesn't resend these.
        const nowIgnored = new Set(toIgnore.map((pa) => pa.plaidAccountId));
        const nowTracked = new Set(toUnignore);
        setAccounts((prev) =>
          prev.map((a) =>
            nowIgnored.has(a.plaidAccountId)
              ? { ...a, ignored: true }
              : nowTracked.has(a.plaidAccountId)
                ? { ...a, ignored: false }
                : a,
          ),
        );
        setTrackAgain(new Set());
      }

      for (const pa of toMap) {
        const row = rows[pa.plaidAccountId];
        let accountId = row.accountId;
        if (row.mode === "create") {
          const res = await fetch("/api/plaid/create-ledger-account", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              displayName: row.displayName.trim(),
              accountType: row.accountType,
              defaultEntityId: row.entityId,
              issuerParser,
            }),
          });
          const data = await res.json();
          if (!res.ok) {
            throw new Error(
              `Could not create "${row.displayName.trim()}": ${data.error ?? "unknown error"}`,
            );
          }
          accountId = data.id as string;
          createdNames.push(data.displayName as string);
          setCreatedAccounts((c) => [
            ...c,
            {
              id: data.id,
              displayName: data.displayName,
              accountType: row.accountType,
              issuerParser,
            },
          ]);
          // Point the row at the account we just made so a retry reuses it rather than making a twin.
          setRow(pa.plaidAccountId, { mode: "existing", accountId });
        }
        links.push({
          plaidAccountId: pa.plaidAccountId,
          accountId,
          plaidName: pa.name,
          plaidMask: pa.mask,
          plaidType: pa.type,
        });
      }

      // Ignore-only save: nothing to map, so don't call map-accounts at all — it would null this
      // connection's sync cursor for no reason.
      if (links.length > 0) {
        // Only send a cutover on a connection that has none yet (zero links). Once links exist,
        // map-accounts ignores it anyway, and sending one risks moving an established cutover.
        const res = await fetch("/api/plaid/map-accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            isFirstMapping && cutoverDate
              ? { connectionId, links, cutoverDate }
              : { connectionId, links },
          ),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not save mapping");
      }

      const done: string[] = [];
      if (links.length > 0) {
        done.push(`mapped ${links.length} account${links.length === 1 ? "" : "s"}`);
      }
      if (untracked > 0) {
        done.push(`marked ${untracked} account${untracked === 1 ? "" : "s"} as not tracked`);
      }
      if (retracked > 0) {
        done.push(`put ${retracked} account${retracked === 1 ? "" : "s"} back on`);
      }
      reset();
      // Neither call changes connection status — that's re-decided on the next sync (run-sync.ts).
      // Say so, or a still-amber badge after a save reads as "the save failed".
      setSavedMsg(
        `${done.length > 0 ? `Saved: ${done.join(", ")}` : "Nothing to change — the server was already in this state"}. Click Sync now to finish: that's when mapped accounts pull in, and it's also when a bank whose last undecided accounts are now untracked goes back to healthy.`,
      );
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not save";
      // Partial-failure honesty: whatever already landed is real on the server. Name it, so the
      // retry doesn't look like a fresh start and created accounts aren't duplicated.
      if (createdNames.length > 0) {
        landed.push(`these ledger accounts were created: ${createdNames.join(", ")}`);
      }
      setError(
        landed.length > 0
          ? `${msg} — but this part already saved: ${landed.join("; ")}. Fix the problem and save again; the parts that landed won't be redone.`
          : msg,
      );
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="mt-3 space-y-2">
        <button
          onClick={loadAccounts}
          disabled={busy}
          className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted/30 disabled:opacity-50"
        >
          {busy ? "…" : "Map accounts"}
        </button>
        {savedMsg ? (
          <p className="text-sm text-emerald-600 dark:text-emerald-400">{savedMsg}</p>
        ) : null}
        {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-4 rounded-xl border border-border bg-background p-4">
      <div>
        <h3 className="font-semibold">Map {liveInstitution ?? "bank"} accounts</h3>
        <p className="text-sm text-muted-foreground">
          Pick which Hundie account each Plaid account feeds, create one, or mark it as never
          belonging in the ledger. Every account has to be settled one way or the other before this
          bank stops holding its history.
        </p>
      </div>

      {mapped.length > 0 ? (
        <div className="divide-y divide-border border-t border-border">
          {mapped.map((pa) => (
            <div
              key={pa.plaidAccountId}
              className="flex items-center justify-between gap-3 py-2 text-sm"
            >
              <span>
                {pa.name}{" "}
                {showMask(pa) ? <span className="text-muted-foreground">••{pa.mask}</span> : null}
              </span>
              <span className="text-muted-foreground">→ {pa.mappedAccountName ?? "mapped"}</span>
            </div>
          ))}
        </div>
      ) : null}

      {notTracked.length > 0 ? (
        <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
          <p className="text-sm font-medium">Not tracked</p>
          <p className="text-xs text-muted-foreground">
            Deliberately left out of the ledger. Not one transaction from these accounts is
            imported, and they no longer hold this bank&apos;s sync. Nothing here is permanent —
            undo any of them and it goes back to needing a decision.
          </p>
          <div className="divide-y divide-border">
            {notTracked.map((pa) => (
              <div
                key={pa.plaidAccountId}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
              >
                <span className="text-muted-foreground">
                  {pa.name} {showMask(pa) ? <span>••{pa.mask}</span> : null}
                </span>
                <button
                  onClick={() => startTrackingAgain(pa)}
                  disabled={busy}
                  className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted/30 disabled:opacity-50"
                >
                  Track this account again
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {needsDecision.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {notTracked.length > 0
            ? "Every account here is either mapped or marked not tracked, so nothing is holding this bank's sync. Click Sync now and it goes back to healthy."
            : "Every account on this connection is already mapped."}
        </p>
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
            <p>
              <strong className="text-foreground">— decide later —</strong> saves nothing. The
              account stays unmapped, so this bank keeps its{" "}
              <strong className="text-foreground">needs mapping</strong> flag and its sync replays
              the same window instead of moving forward.
            </p>
            <p className="mt-1.5">
              <strong className="text-foreground">Don&apos;t track this account</strong> is the one
              that releases it. Hundie records the decision, never imports a single transaction from
              that account, and the next sync puts this bank back to{" "}
              <strong className="text-foreground">healthy</strong>. Reversible — untracked accounts
              stay listed above with a{" "}
              <strong className="text-foreground">Track this account again</strong> button.
            </p>
          </div>

          {needsDecision.map((pa) => {
            const row = rows[pa.plaidAccountId] ?? defaultRow(pa);
            const options = optionsFor(pa.plaidAccountId);
            return (
              <div key={pa.plaidAccountId} className="space-y-2 border-t border-border pt-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-sm font-medium">
                    {pa.name}{" "}
                    {showMask(pa) ? (
                      <span className="text-muted-foreground">••{pa.mask}</span>
                    ) : null}
                  </span>
                  <select
                    value={row.mode}
                    onChange={(e) =>
                      // Clear accountId on every mode change: a stale id left armed here would still
                      // be submitted while its <select> is hidden, landing two links on one Hundie
                      // account (unique(account_id) → 500) after ledger accounts were already made.
                      setRow(pa.plaidAccountId, { mode: e.target.value as RowMode, accountId: "" })
                    }
                    disabled={busy}
                    className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  >
                    <option value="skip">— decide later —</option>
                    <option value="existing">Use existing account</option>
                    <option value="create">Create new account</option>
                    <option value="ignore">Don&apos;t track this account</option>
                  </select>
                </div>

                {trackAgain.has(pa.plaidAccountId) ? (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    This one was not tracked. Saving drops that, so say where it should feed — left
                    on <strong>— decide later —</strong> it goes back to blocking this bank at
                    &ldquo;needs mapping&rdquo;. Choosing{" "}
                    <strong>Don&apos;t track this account</strong> again simply leaves things as
                    they are.
                  </p>
                ) : null}

                {row.mode === "existing" ? (
                  options.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Every active Hundie account is already linked to a Plaid account. Choose{" "}
                      <strong>Create new account</strong> instead.
                    </p>
                  ) : (
                    <select
                      value={row.accountId}
                      onChange={(e) =>
                        setRow(pa.plaidAccountId, { accountId: e.target.value })
                      }
                      disabled={busy}
                      className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm sm:w-auto"
                    >
                      <option value="">— pick an account —</option>
                      {options.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.displayName}
                        </option>
                      ))}
                    </select>
                  )
                ) : null}

                {row.mode === "ignore" ? (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                      Saved as a decision, not a skip: no transaction from this account is ever
                      imported, and it stops holding this bank&apos;s sync — that is what lets the
                      connection go back to healthy. Undo it from this panel whenever you want.
                    </p>
                    <label className="flex flex-col gap-1 text-sm sm:w-2/3">
                      <span className="font-medium">Why (optional)</span>
                      <input
                        type="text"
                        value={row.reason}
                        onChange={(e) => setRow(pa.plaidAccountId, { reason: e.target.value })}
                        disabled={busy}
                        placeholder="personal savings — not part of the books"
                        className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                      />
                      <span className="text-xs text-muted-foreground">
                        Stored with the decision so a future you knows it was on purpose.
                      </span>
                    </label>
                  </div>
                ) : null}

                {row.mode === "create" ? (
                  <div className="space-y-2">
                    <div className="grid gap-2 sm:grid-cols-3">
                      <label className="flex flex-col gap-1 text-sm">
                        <span className="font-medium">Account name</span>
                        <input
                          type="text"
                          value={row.displayName}
                          onChange={(e) =>
                            setRow(pa.plaidAccountId, { displayName: e.target.value })
                          }
                          disabled={busy}
                          className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-sm">
                        <span className="font-medium">Entity</span>
                        <select
                          value={row.entityId}
                          onChange={(e) =>
                            setRow(pa.plaidAccountId, { entityId: e.target.value })
                          }
                          disabled={busy}
                          className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                        >
                          <option value="">— choose an entity —</option>
                          {entities.map((en) => (
                            <option key={en.id} value={en.id}>
                              {en.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-sm">
                        <span className="font-medium">Account type</span>
                        <select
                          value={row.accountType}
                          onChange={(e) =>
                            setRow(pa.plaidAccountId, {
                              accountType: e.target.value as AccountTypeValue,
                            })
                          }
                          disabled={busy}
                          className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                        >
                          {(Object.keys(ACCOUNT_TYPE_LABELS) as AccountTypeValue[]).map((t) => (
                            <option key={t} value={t}>
                              {ACCOUNT_TYPE_LABELS[t]}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Entity drives tax treatment, so nothing is pre-selected — pick it yourself.
                      Issuer will be saved as <code className="font-mono">{issuerParser}</code>.
                    </p>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {isFirstMapping && toMap.length > 0 ? (
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Plaid start date (cutover)</span>
          <input
            type="date"
            value={cutoverDate}
            onChange={(e) => setCutoverDate(e.target.value)}
            disabled={busy}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm sm:w-auto"
          />
          <span className="text-muted-foreground">
            This bank has never been mapped, so set where Plaid should start. Leave blank and it
            starts the day after the last transaction already in the mapped accounts — for brand-new
            accounts that means the day the bank was linked, and anything earlier is never pulled.
          </span>
        </label>
      ) : null}

      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={busy || !actionable}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save changes"}
        </button>
        <button
          onClick={cancel}
          disabled={busy}
          className="rounded-md border border-border px-3 py-1.5 text-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
