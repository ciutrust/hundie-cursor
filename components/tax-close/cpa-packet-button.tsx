"use client";

import { useState, useTransition } from "react";
import { Download } from "lucide-react";
import { exportCpaPacketCsv } from "@/lib/actions/reports";

type CpaPacketButtonProps = {
  entitySlug: string;
  entityName: string;
  year: number;
};

/** #6: downloads a per-entity, per-year CPA tax-line packet CSV (blob download; no new dep). */
export function CpaPacketButton({ entitySlug, entityName, year }: CpaPacketButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function download() {
    setError(null);
    startTransition(async () => {
      try {
        const csv = await exportCpaPacketCsv({ entitySlug, year });
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `cpa-packet-${entitySlug}-${year}.csv`;
        anchor.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Export failed");
      }
    });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={download}
        disabled={isPending}
        className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium hover:bg-muted/30 disabled:opacity-50"
      >
        <Download className="h-4 w-4" />
        {isPending ? "Preparing…" : `${entityName} packet`}
      </button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
