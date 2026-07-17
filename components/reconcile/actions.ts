"use server";

/**
 * The read behind the reconcile prompt.
 *
 * Lives here rather than in lib/actions/ because lib/queries/expense-captures.ts is a plain server
 * module: a Client Component cannot call getCaptureMatchSuggestion directly, so the prompt needs a
 * "use server" door. It is a READ ONLY — the writes it leads to (reconcileCapture, markCaptureAsCash)
 * are the existing actions in lib/actions/expense-captures.ts.
 */

import { requireUser } from "@/lib/auth/require-user";
import { getCaptureMatchSuggestion, getUnmatchedCaptures } from "@/lib/queries/expense-captures";

export type CaptureMatchCandidate = {
  transactionId: string;
  description: string;
  amount: number;
  /** YYYY-MM-DD */
  date: string;
  /** Days the charge posted after the receipt. */
  deltaDays: number;
  /** How far above the receipt the charge is (0.2 = a 20% tip). */
  tipRatio: number;
  /** True when this charge is one of the ones he just added — orients him in an ambiguous list. */
  justAdded: boolean;
};

export type CaptureMatchPrompt = {
  captureId: string;
  label: string;
  amount: number | null;
  /** YYYY-MM-DD */
  date: string;
  note: string | null;
  hasPhoto: boolean;
  hasLocation: boolean;
  /** Best first. */
  candidates: CaptureMatchCandidate[];
  /** The one-tap match. null = too close to call, make him pick from `candidates`. */
  confidentTransactionId: string | null;
};

type Suggestion = NonNullable<Awaited<ReturnType<typeof getCaptureMatchSuggestion>>>;

/** Shared shaping so the "just added" prompt and the deep-linked one can never drift apart. */
function toPrompt(suggestion: Suggestion, justAdded: Set<string>): CaptureMatchPrompt {
  const { capture } = suggestion;
  return {
    captureId: capture.id,
    label: capture.vendor?.trim() || "Receipt",
    amount: capture.amount == null ? null : Number(capture.amount),
    date: capture.captured_at.slice(0, 10),
    note: capture.note,
    hasPhoto: capture.photo_status === "uploaded",
    hasLocation: capture.latitude !== null && capture.longitude !== null,
    candidates: suggestion.candidates.map((candidate) => ({
      transactionId: candidate.transactionId,
      description: candidate.charge.description,
      amount: Number(candidate.charge.amount),
      date: candidate.charge.transaction_date,
      deltaDays: candidate.deltaDays,
      tipRatio: candidate.tipRatio,
      justAdded: justAdded.has(candidate.transactionId),
    })),
    confidentTransactionId:
      suggestion.confident && (justAdded.size === 0 || justAdded.has(suggestion.confident.transactionId))
        ? suggestion.confident.transactionId
        : null,
  };
}

/**
 * Every plausible charge for ONE capture — behind the report's "Find the charge" link.
 *
 * Unscoped on purpose: this is him going looking, days later, so the twin is whatever is in the window,
 * not something he just added.
 */
export async function getCaptureMatchPromptForCapture(
  captureId: string,
): Promise<CaptureMatchPrompt | null> {
  const { error: authError } = await requireUser();
  if (authError) throw new Error(authError);

  const suggestion = await getCaptureMatchSuggestion(captureId);
  // Cash is terminal: no charge is ever coming, so there is nothing to look for.
  if (!suggestion || suggestion.capture.capture_kind === "cash") return null;

  return toPrompt(suggestion, new Set());
}

/**
 * "Did one of the charges you just added already have a receipt sitting in this report?"
 *
 * The double-count this prevents: a $18.42 Chipotle capture waits in report 0001 for its charge; the
 * $22.10 "SQ *XXXX 4471" lands; he adds it and moves on. Both lines now count and he files $40.52 for
 * one burrito. buildExpenseReportLines only folds the capture away once it is MATCHED, so the match
 * has to be offered at exactly this moment or it never happens.
 *
 * Scoped two ways on purpose:
 *  - only captures already parked in THIS report (a capture elsewhere isn't a double-count here);
 *  - only captures that one of the JUST-ADDED charges could plausibly have settled, so adding a hotel
 *    bill doesn't re-litigate every open receipt on the trip.
 */
export async function getCaptureMatchPrompts(input: {
  reportId: string;
  transactionIds: string[];
}): Promise<CaptureMatchPrompt[]> {
  const { error: authError } = await requireUser();
  if (authError) throw new Error(authError);
  if (input.transactionIds.length === 0) return [];

  // getUnmatchedCaptures is already card-only + unmatched — cash is terminal and never double-counts.
  const unmatched = await getUnmatchedCaptures();
  const waiting = unmatched.filter((capture) => capture.expense_report_id === input.reportId);
  if (waiting.length === 0) return [];

  const justAdded = new Set(input.transactionIds);
  const suggestions = await Promise.all(
    waiting.map((capture) => getCaptureMatchSuggestion(capture.id)),
  );

  const prompts: CaptureMatchPrompt[] = [];

  for (const suggestion of suggestions) {
    if (!suggestion) continue;
    if (!suggestion.candidates.some((candidate) => justAdded.has(candidate.transactionId))) continue;

    const { capture } = suggestion;

    // Only ever offer the one-tap confirm for a charge FROM THIS ADD. If the matcher's confident pick
    // is some other charge, this capture's real twin probably isn't what he just added — downgrade to
    // "pick one" rather than nudging him toward the wrong row.
    const confidentTransactionId =
      suggestion.confident && justAdded.has(suggestion.confident.transactionId)
        ? suggestion.confident.transactionId
        : null;

    prompts.push({
      captureId: capture.id,
      label: capture.vendor?.trim() || "Receipt",
      amount: capture.amount == null ? null : Number(capture.amount),
      date: capture.captured_at.slice(0, 10),
      note: capture.note,
      hasPhoto: capture.photo_status === "uploaded",
      hasLocation: capture.latitude !== null && capture.longitude !== null,
      // Every candidate, not just the just-added ones: when it's too close to call he needs to see the
      // charge that made it ambiguous, even if that charge came into the report some other way.
      candidates: suggestion.candidates.map((candidate) => ({
        transactionId: candidate.transactionId,
        description: candidate.charge.description,
        amount: Number(candidate.charge.amount),
        date: candidate.charge.transaction_date,
        deltaDays: candidate.deltaDays,
        tipRatio: candidate.tipRatio,
        justAdded: justAdded.has(candidate.transactionId),
      })),
      confidentTransactionId,
    });
  }

  return prompts;
}
