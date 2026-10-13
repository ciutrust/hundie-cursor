"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateAssetValue } from "@/lib/actions/update-asset-value";
import { cn, formatCurrency } from "@/lib/utils";
import { useStoredView, ViewToggle } from "./view-toggle";

export type AssetCard = {
  id: string;
  name: string;
  type: string;
  entity: string;
  value: number;
  notes: string | null;
};

function label(type: string) {
  return type.replaceAll("_", " ");
}

function ValueField({ id, value }: { id: string; value: number }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const parsed = Number(draft.replace(/[$,\s]/g, ""));
    if (!Number.isFinite(parsed) || parsed < 0) {
      setError("Enter a dollar amount");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await updateAssetValue({ id, value: parsed });
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setEditing(false);
    router.refresh();
  }

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-2">
        <p className="text-lg font-semibold tabular-nums">{formatCurrency(value)}</p>
        <button
          type="button"
          onClick={() => {
            setDraft(String(value));
            setError(null);
            setEditing(true);
          }}
          className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          Edit
        </button>
      </div>
    );
  }

  return (
    <form
      className="space-y-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <input
        autoFocus
        inputMode="decimal"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        aria-label="Value"
        className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm tabular-nums"
      />
      <div className="flex gap-1.5">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setEditing(false)}
          className="rounded-md border border-border px-2 py-1 text-xs"
        >
          Cancel
        </button>
      </div>
      {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
    </form>
  );
}

function AssetItem({ asset, view }: { asset: AssetCard; view: "grid" | "list" }) {
  return (
    <article
      className={cn(
        "rounded-xl border border-border bg-card p-4",
        view === "grid" ? "flex min-h-44 flex-col justify-between" : "flex flex-col gap-3 sm:flex-row sm:items-center",
      )}
    >
      <div className={cn("min-w-0", view === "list" && "sm:flex-1")}>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label(asset.type)}
        </p>
        <h2 className="mt-1 text-sm font-semibold leading-snug">{asset.name}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{asset.entity}</p>
        {asset.notes ? <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{asset.notes}</p> : null}
      </div>
      <div className={cn(view === "list" && "sm:w-56")}>
        <ValueField id={asset.id} value={asset.value} />
      </div>
    </article>
  );
}

export function AssetsBoard({ assets, total }: { assets: AssetCard[]; total: string }) {
  const [view, setView] = useStoredView("hundie:assets-view");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Assets</h1>
          <p className="text-sm text-muted-foreground">Total value: {total}</p>
        </div>
        <ViewToggle view={view} onChange={setView} />
      </div>
      {assets.length === 0 ? (
        <p className="text-sm text-muted-foreground">No assets yet.</p>
      ) : (
        <div className={view === "grid" ? "grid gap-3 sm:grid-cols-2 xl:grid-cols-3" : "space-y-2"}>
          {assets.map((asset) => (
            <AssetItem key={asset.id} asset={asset} view={view} />
          ))}
        </div>
      )}
    </div>
  );
}
