"use client";

import { useRef, useState, useTransition } from "react";
import { Upload } from "lucide-react";
import { importAmazonExport, rematchAmazonCharges } from "@/lib/actions/amazon";
import { Button } from "@/components/ui/button";

type AmazonUploadPanelProps = {
  lastBatch: {
    file_name: string | null;
    item_count: number;
    shipment_count: number;
    created_at: string;
  } | null;
};

export function AmazonUploadPanel({ lastBatch }: AmazonUploadPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setMessage(null);
    const fd = new FormData();
    fd.set("file", file);
    startTransition(async () => {
      const res = await importAmazonExport(fd);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setMessage(
        `Imported ${res.shipmentCount} shipments (${res.itemCount} items). Tier A matches: ${res.matched}.`,
      );
    });
  }

  function onRematch() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const res = await rematchAmazonCharges();
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setMessage(
        `Rematch: ${res.matched} unique (A), ${res.ambiguous} ambiguous (B), ${res.unmatched} unmatched (C).`,
      );
    });
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-medium">Import Your Orders</p>
          <p className="max-w-xl text-xs text-muted-foreground">
            Amazon → Account → Request Your Information → Your Orders. Upload the zip (or just{" "}
            <span className="font-mono">Order History.csv</span>). No passwords or API tokens —
            personal exports only for now.
          </p>
          {lastBatch ? (
            <p className="text-xs text-muted-foreground">
              Last import: {lastBatch.file_name ?? "export"} · {lastBatch.shipment_count} shipments ·{" "}
              {new Date(lastBatch.created_at).toLocaleString()}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">No imports yet.</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={inputRef}
            type="file"
            accept=".zip,.csv,application/zip,text/csv"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          <Button
            type="button"
            disabled={pending}
            onClick={() => inputRef.current?.click()}
            className="gap-2"
          >
            <Upload className="h-4 w-4" />
            {pending ? "Working…" : "Upload export"}
          </Button>
          <Button type="button" variant="outline" disabled={pending} onClick={onRematch}>
            Rematch charges
          </Button>
        </div>
      </div>
      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-700 dark:text-emerald-400">{message}</p> : null}
    </div>
  );
}
