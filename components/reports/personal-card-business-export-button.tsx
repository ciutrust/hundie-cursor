"use client";

import { useState, useTransition } from "react";
import { exportPersonalCardBusinessCsv } from "@/lib/actions/personal-card-business-report";

type Props = {
  period: { type?: string; at?: string; month?: string };
  periodLabel: string;
};

export function PersonalCardBusinessExportButton({ period, periodLabel }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleExport() {
    setError(null);
    startTransition(async () => {
      try {
        const csv = await exportPersonalCardBusinessCsv(period);
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `business-expenses-personal-cards-${periodLabel.replace(/\s+/g, "-").toLowerCase()}.csv`;
        anchor.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Export failed");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleExport}
        disabled={pending}
        className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-muted disabled:opacity-50"
      >
        {pending ? "Exporting…" : "Export CSV"}
      </button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
