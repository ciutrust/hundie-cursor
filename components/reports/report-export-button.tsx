"use client";

import { useTransition } from "react";
import { exportReportCsv } from "@/lib/actions/reports";
import { Button } from "@/components/ui/button";

type ReportExportButtonProps = {
  period: { type: string; at: string; month?: string };
  rowCount: number;
  periodLabel: string;
};

export function ReportExportButton({ period, rowCount, periodLabel }: ReportExportButtonProps) {
  const [isPending, startTransition] = useTransition();

  function download() {
    startTransition(async () => {
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
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={download} disabled={isPending}>
      {isPending ? "Preparing…" : `Export CSV (${rowCount} rows)`}
    </Button>
  );
}
