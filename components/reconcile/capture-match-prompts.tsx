"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banknote, Check, MapPin, Paperclip, Sparkles, X } from "lucide-react";
import { formatBillDate } from "@/components/bills/format";
import { Button } from "@/components/ui/button";
import { markCaptureAsCash, reconcileCapture } from "@/lib/actions/expense-captures";
import { formatCurrency } from "@/lib/utils";
import type { CaptureMatchCandidate, CaptureMatchPrompt } from "./actions";

/** "+20% tip · 2 days later" — the two facts that make a match believable or obviously wrong. */
function candidateHint(candidate: CaptureMatchCandidate): string {
  const parts: string[] = [];
  if (candidate.tipRatio > 0) parts.push(`+${Math.round(candidate.tipRatio * 100)}% tip`);
  parts.push(
    candidate.deltaDays === 0
      ? "same day"
      : `${candidate.deltaDays} day${candidate.deltaDays === 1 ? "" : "s"} later`,
  );
  return parts.join(" · ");
}

function CaptureSummary({ prompt }: { prompt: CaptureMatchPrompt }) {
  return (
    <span className="min-w-0">
      <span className="font-medium">{prompt.label}</span>{" "}
      {prompt.amount === null ? (
        <span className="text-muted-foreground">(no amount)</span>
      ) : (
        <span className="tabular-nums">{formatCurrency(prompt.amount)}</span>
      )}{" "}
      <span className="text-muted-foreground">{formatBillDate(prompt.date)}</span>
      {prompt.hasPhoto ? (
        <Paperclip className="ml-1 inline h-3 w-3 align-[-1px] text-muted-foreground" aria-label="has photo" />
      ) : null}
      {prompt.hasLocation ? (
        <MapPin className="ml-1 inline h-3 w-3 align-[-1px] text-muted-foreground" aria-label="has location" />
      ) : null}
    </span>
  );
}

function ChargeSummary({ candidate }: { candidate: CaptureMatchCandidate }) {
  return (
    <span className="min-w-0">
      <span>{candidate.description}</span>{" "}
      <span className="tabular-nums">{formatCurrency(candidate.amount)}</span>{" "}
      <span className="text-muted-foreground">{formatBillDate(candidate.date)}</span>
    </span>
  );
}

export type CaptureMatchPromptsProps = {
  prompts: CaptureMatchPrompt[];
};

/**
 * "These might be the same spend" — the guard against filing one burrito twice.
 *
 * A capture only stops counting as its own line once it is MATCHED to a charge that is a counted member
 * of the same report (see lib/expense-report-lines.ts). So the moment a charge joins a report that is
 * already holding its receipt is the moment the double-count is created, and the only moment he has the
 * context to resolve it. Hence: prompt here, not later.
 *
 * NEVER auto-matches. When the matcher can't separate two charges, this makes him pick — a silently
 * wrong match quietly corrupts the report's total and he would never catch it.
 */
export function CaptureMatchPrompts({ prompts }: CaptureMatchPromptsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  // Charges matched during this session. One charge backs at most one capture (the DB enforces it), so
  // an already-claimed charge must stop being offered to the next prompt in the list.
  const [claimed, setClaimed] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const visible = prompts
    .filter((prompt) => !dismissed.has(prompt.captureId) && !resolved.has(prompt.captureId))
    .map((prompt) => ({
      ...prompt,
      candidates: prompt.candidates.filter((candidate) => !claimed.has(candidate.transactionId)),
      confidentTransactionId:
        prompt.confidentTransactionId && !claimed.has(prompt.confidentTransactionId)
          ? prompt.confidentTransactionId
          : null,
      // The server only leaves confidentTransactionId null when the matcher genuinely couldn't separate
      // two charges. Losing the confident pick to `claimed` above is a different story, and saying
      // "too close to call" for it would be a lie about the ledger.
      ambiguous: prompt.confidentTransactionId === null,
    }))
    .filter((prompt) => prompt.candidates.length > 0);

  if (visible.length === 0 && !error) return null;

  const confirm = (captureId: string, transactionId: string) =>
    startTransition(async () => {
      const result = await reconcileCapture({ captureId, transactionId });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setError(null);
      setResolved((prev) => new Set(prev).add(captureId));
      setClaimed((prev) => new Set(prev).add(transactionId));
      router.refresh();
    });

  const cash = (captureId: string) =>
    startTransition(async () => {
      const result = await markCaptureAsCash(captureId);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setError(null);
      setResolved((prev) => new Set(prev).add(captureId));
      router.refresh();
    });

  const dismiss = (captureId: string) => setDismissed((prev) => new Set(prev).add(captureId));

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
      <div className="mb-1 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-amber-500" />
        <h2 className="text-sm font-semibold">Same spend as a receipt already on this report?</h2>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Match them or the report counts both and you file twice.
      </p>

      <ul className="space-y-2">
        {visible.map((prompt) => {
          const confident = prompt.confidentTransactionId
            ? prompt.candidates.find((c) => c.transactionId === prompt.confidentTransactionId)
            : undefined;

          return (
            <li
              key={prompt.captureId}
              className="rounded-lg border border-border bg-card px-3 py-2"
            >
              {confident ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <p className="min-w-0 flex-1 text-sm">
                    <CaptureSummary prompt={prompt} />
                    <span className="mx-1.5 text-muted-foreground">↔</span>
                    <ChargeSummary candidate={confident} />{" "}
                    <span className="text-xs text-muted-foreground">({candidateHint(confident)})</span>
                  </p>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      disabled={isPending}
                      onClick={() => confirm(prompt.captureId, confident.transactionId)}
                    >
                      <Check className="mr-1 h-3.5 w-3.5" /> Same spend
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      title="Different spends - leave both on the report"
                      onClick={() => dismiss(prompt.captureId)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <p className="min-w-0 flex-1 text-sm">
                      <CaptureSummary prompt={prompt} />
                    </p>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      title="Different spends - leave both on the report"
                      onClick={() => dismiss(prompt.captureId)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  {/* No one-tap winner, so he decides. Never auto-match: a wrong match silently
                      corrupts the total and he would never catch it. */}
                  <p className="text-xs text-muted-foreground">
                    {prompt.ambiguous
                      ? "Too close to call. Which charge settled this receipt?"
                      : "Which charge settled this receipt?"}
                  </p>
                  <ul className="space-y-1">
                    {prompt.candidates.map((candidate) => (
                      <li
                        key={candidate.transactionId}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border/60 px-2 py-1.5"
                      >
                        <p className="min-w-0 flex-1 text-sm">
                          <ChargeSummary candidate={candidate} />{" "}
                          <span className="text-xs text-muted-foreground">
                            ({candidateHint(candidate)})
                          </span>
                          {candidate.justAdded ? (
                            <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                              just added
                            </span>
                          ) : null}
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isPending}
                          onClick={() => confirm(prompt.captureId, candidate.transactionId)}
                        >
                          <Check className="mr-1 h-3.5 w-3.5" /> Same spend
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {prompt.note ? (
                <p className="mt-1.5 text-xs italic text-muted-foreground">{prompt.note}</p>
              ) : null}

              <div className="mt-1.5">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => cash(prompt.captureId)}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
                  title="No charge is coming for this one - it stays on the report as its own line."
                >
                  <Banknote className="h-3 w-3" /> It was cash
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {error ? (
        <p role="alert" className="mt-3 text-sm font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
