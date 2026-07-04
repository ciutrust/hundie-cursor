"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { generateProposals } from "@/lib/actions/generate-proposals";

type GenerateControlsProps = {
  entitySlug: string;
  entityName: string;
};

/**
 * #4 — in-app "Generate proposals" for the current entity. Deterministic (training-based); writes only
 * to the staging table. Re-running resets pending/approved rows to pending but NEVER un-commits (the
 * action excludes already-committed transactions).
 */
export function GenerateControls({ entitySlug, entityName }: GenerateControlsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function generate() {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await generateProposals(entitySlug);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      const skipped =
        result.skippedCommitted > 0 ? ` · ${result.skippedCommitted} committed left untouched` : "";
      setMessage(`Generated ${result.generated} proposal${result.generated === 1 ? "" : "s"}${skipped}.`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={generate}
        disabled={isPending}
        title={`Regenerate deterministic proposals for ${entityName} (staging only — nothing touches the ledger)`}
        className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium hover:bg-muted/30 disabled:opacity-50"
      >
        <RefreshCw className={`h-4 w-4 ${isPending ? "animate-spin" : ""}`} />
        {isPending ? "Generating…" : "Generate proposals"}
      </button>
      {message ? <p className="text-xs text-emerald-600 dark:text-emerald-400">{message}</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
