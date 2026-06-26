"use client";

import { useState, useTransition } from "react";
import { exportReportCsv } from "@/lib/actions/reports";
import { Button } from "@/components/ui/button";

type ReportExportButtonProps = {
  period: { type: string; at: string; month?: string };
  rowCount: number;
  periodLabel: string;
};

export function ReportExportButton({ period, rowCount, periodLabel }: ReportExportButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function download() {
    setError(null);
    startTransition(async () => {
      try {
        const csv = await exportReportCsv({
          period: period.type,
          at: period.at,
          month: period.month,
        });
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `hundie-report-${periodLabel.replace(/\s+/g, "-").toLowerCase()}.csv`;
        anchor.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Export failed");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="outline" size="sm" onClick={download} disabled={isPending}>
        {isPending ? "Preparing…" : `Export CSV (${rowCount} rows)`}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
