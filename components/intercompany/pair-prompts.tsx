"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Link2, Sparkles, X } from "lucide-react";
import { formatBillDate } from "@/components/bills/format";
import { Button } from "@/components/ui/button";
import {
  dismissIntercompanyPair,
  linkIntercompanyPair,
  linkIntercompanyPairs,
} from "@/lib/actions/intercompany";
import { categoryPairTemplate, suggestLinkKind } from "@/lib/intercompany-pairing";
import { formatCurrency } from "@/lib/utils";
import type { LinkKind, PairLeg, PairSuggestion } from "@/lib/queries/intercompany";

const KIND_LABELS: Record<LinkKind, string> = {
  owner_funding: "Owner funding",
  intercompany_service: "Intercompany",
  internal_transfer: "Internal transfer",
};

const KIND_BADGE_CLASSES: Record<LinkKind, string> = {
  owner_funding: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  intercompany_service: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
  internal_transfer: "bg-muted text-muted-foreground",
};

function KindBadge({ kind }: { kind: LinkKind }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${KIND_BADGE_CLASSES[kind]}`}
    >
      {KIND_LABELS[kind]}
    </span>
  );
}

function EntityBadge({ slug }: { slug: string }) {
  return (
    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      {slug}
    </span>
  );
}

function RefChip({ token }: { token: string }) {
  return (
    <span
      className="ml-1.5 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
      title="Wells Fargo stamps the same reference on both legs - this is the same transfer"
    >
      {token}
    </span>
  );
}

function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** One leg, inline: date, entity badge, amount, truncated description. Account id lives in the title. */
function LegSummary({ leg }: { leg: PairLeg }) {
  return (
    <span className="min-w-0" title={`${leg.description} (account ${leg.accountId})`}>
      <span className="text-muted-foreground">{formatBillDate(leg.transactionDate)}</span>{" "}
      <EntityBadge slug={leg.entitySlug} />{" "}
      <span className="font-medium tabular-nums">{formatCurrency(leg.amount)}</span>{" "}
      <span className="text-muted-foreground">{clip(leg.description, 48)}</span>
    </span>
  );
}

/**
 * "will file as X / Y" - only for a side that is still uncategorized AND has a template for this
 * entity pair. Sides already categorized show where they already sit (muted), so linking never
 * looks like it might move an existing category. Kind is derived from THIS candidate's entities
 * (same derivation the server does on link), so the preview is truthful per row, not per card.
 */
function CategoryPreview({ out, counterpart }: { out: PairLeg; counterpart: PairLeg }) {
  const kind = suggestLinkKind(out.entitySlug, counterpart.entitySlug);
  const template = categoryPairTemplate(kind, out.entitySlug, counterpart.entitySlug);

  const side = (leg: PairLeg, templatePath: string | undefined) => {
    if (leg.categoryId !== null) {
      return leg.categoryPath ? (
        <span className="text-muted-foreground">
          {leg.entitySlug}: {leg.categoryPath}
        </span>
      ) : null;
    }
    if (!templatePath) return null;
    return (
      <span>
        {leg.entitySlug}: will file as{" "}
        <span className="font-medium text-foreground/90">{templatePath}</span>
      </span>
    );
  };

  const outNode = side(out, template?.outPath);
  const inNode = side(counterpart, template?.inPath);
  if (!outNode && !inNode) return null;

  return (
    <p className="mt-1 text-xs text-muted-foreground">
      {outNode}
      {outNode && inNode ? <span className="mx-1.5">·</span> : null}
      {inNode}
    </p>
  );
}

export type PairPromptsProps = {
  suggestions: PairSuggestion[];
};

/**
 * "These two legs are the same transfer" - link them or the books stay one-sided.
 *
 * NEVER auto-links. Confident matches get a one-tap row (and a confident-only bulk button);
 * when the matcher can't separate candidates, AC picks. A silently wrong link crosses money
 * between entities and he would never catch it.
 */
export function PairPrompts({ suggestions }: PairPromptsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Dismissals are PAIR-scoped (`${outId}:${inId}`), mirroring the DB table. Keying by out-leg
  // alone hid the whole card while the server, post-refresh, correctly re-suggested the same out
  // with a different candidate - the leg then rendered nowhere until a remount.
  const [dismissedLocal, setDismissedLocal] = useState<Set<string>>(new Set());
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  // In-legs consumed this session. One in-leg closes at most one out-leg, so a claimed
  // counterpart must stop being offered to the next suggestion in the list.
  const [claimed, setClaimed] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const pairKey = (outId: string, inId: string) => `${outId}:${inId}`;

  const visible = suggestions
    .filter((s) => !resolved.has(s.out.transactionId))
    .map((s) => ({
      ...s,
      candidates: s.candidates.filter(
        (c) =>
          !claimed.has(c.transactionId) &&
          !dismissedLocal.has(pairKey(s.out.transactionId, c.transactionId)),
      ),
      confidentInId:
        s.confidentInId &&
        !claimed.has(s.confidentInId) &&
        !dismissedLocal.has(pairKey(s.out.transactionId, s.confidentInId))
          ? s.confidentInId
          : null,
      // The server only leaves confidentInId null when it genuinely couldn't separate
      // candidates. Losing the confident pick to `claimed` above is a different story, and
      // saying "too close to call" for it would be a lie about the ledger.
      ambiguous: s.confidentInId === null,
    }))
    .filter((s) => s.candidates.length > 0);

  if (visible.length === 0 && !notice) return null;

  const confidentVisible = visible.filter((s) => s.confidentInId !== null);

  const setCardError = (outId: string, message: string | null) =>
    setErrors((prev) => {
      const next = { ...prev };
      if (message === null) delete next[outId];
      else next[outId] = message;
      return next;
    });

  const link = (outId: string, inId: string, kind: LinkKind, refToken: string | null) =>
    startTransition(async () => {
      const result = await linkIntercompanyPair({
        outId,
        inId,
        kind,
        refToken: refToken ?? undefined,
      });
      if ("error" in result) {
        setCardError(outId, result.error);
        return;
      }
      setCardError(outId, null);
      const filed = (result.categorizedOut ? 1 : 0) + (result.categorizedIn ? 1 : 0);
      if (filed > 0) {
        setNotice(`Pair linked - ${filed} side${filed === 1 ? "" : "s"} auto-filed.`);
      }
      setResolved((prev) => new Set(prev).add(outId));
      setClaimed((prev) => new Set(prev).add(inId));
      router.refresh();
    });

  // Confident-only by construction: ambiguous suggestions have confidentInId null and are
  // filtered out of confidentVisible, so they can NEVER ride along in the bulk call.
  const linkAll = () =>
    startTransition(async () => {
      const pairs = confidentVisible.map((s) => ({
        outId: s.out.transactionId,
        inId: s.confidentInId as string,
        kind: s.kind,
        refToken: s.refToken ?? undefined,
      }));
      if (pairs.length === 0) return;
      const result = await linkIntercompanyPairs({ pairs });
      if (result.failed > 0) {
        setNotice(
          `Linked ${result.linked}, ${result.failed} failed${
            result.firstError ? `: ${result.firstError}` : ""
          }.`,
        );
        // Don't guess which ones failed - the refresh below re-fetches the true state.
      } else {
        setNotice(`Linked ${result.linked} pair${result.linked === 1 ? "" : "s"}.`);
        setResolved((prev) => new Set([...prev, ...pairs.map((p) => p.outId)]));
        setClaimed((prev) => new Set([...prev, ...pairs.map((p) => p.inId)]));
      }
      router.refresh();
    });

  const dismiss = (outId: string, inId: string) =>
    startTransition(async () => {
      const result = await dismissIntercompanyPair({ outId, inId });
      if ("error" in result) {
        setCardError(outId, result.error);
        return;
      }
      setCardError(outId, null);
      setDismissedLocal((prev) => new Set(prev).add(pairKey(outId, inId)));
      router.refresh();
    });

  // Everything was linked or dismissed away - just report what happened.
  if (visible.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        {notice}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
      <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Sparkles className="h-4 w-4 shrink-0 text-amber-500" />
        <h2 className="text-sm font-semibold">
          {visible.length} suggested pair{visible.length === 1 ? "" : "s"}
        </h2>
        {confidentVisible.length >= 2 ? (
          <Button size="sm" className="ml-auto" disabled={isPending} onClick={linkAll}>
            <Check className="mr-1 h-3.5 w-3.5" />
            {isPending ? "Linking…" : `Link all ${confidentVisible.length} exact matches`}
          </Button>
        ) : null}
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Two legs of the same move between your entities. Link them so neither side double-counts.
      </p>

      {notice ? <p className="mb-2 text-xs text-muted-foreground">{notice}</p> : null}

      <ul className="space-y-2">
        {visible.map((s) => {
          const confident = s.confidentInId
            ? s.candidates.find((c) => c.transactionId === s.confidentInId)
            : undefined;
          const cardError = errors[s.out.transactionId];

          return (
            <li key={s.out.transactionId} className="rounded-lg border border-border bg-card px-3 py-2">
              {confident ? (
                <>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <KindBadge kind={suggestLinkKind(s.out.entitySlug, confident.entitySlug)} />
                    <p className="min-w-0 flex-1 text-sm">
                      <LegSummary leg={s.out} />
                      <Link2 className="mx-1.5 inline h-3.5 w-3.5 align-[-2px] text-muted-foreground" />
                      <LegSummary leg={confident} />
                      {s.refToken ? <RefChip token={s.refToken} /> : null}
                    </p>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        size="sm"
                        disabled={isPending}
                        onClick={() =>
                          link(s.out.transactionId, confident.transactionId, s.kind, s.refToken)
                        }
                      >
                        <Check className="mr-1 h-3.5 w-3.5" /> Link pair
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isPending}
                        title="Not a pair - keep both legs as they are"
                        onClick={() => dismiss(s.out.transactionId, confident.transactionId)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <CategoryPreview out={s.out} counterpart={confident} />
                </>
              ) : (
                <div className="space-y-2">
                  {/* No card-level kind badge here: kind depends on which candidate gets picked,
                      so each candidate row carries its own. */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <p className="min-w-0 flex-1 text-sm">
                      <LegSummary leg={s.out} />
                    </p>
                  </div>
                  {/* No one-tap winner, so he decides. Never auto-link: a wrong link crosses
                      money between entities and he would never catch it. */}
                  <p className="text-xs text-muted-foreground">
                    {s.ambiguous
                      ? "Pick the matching side - too close to call."
                      : "Pick the matching side."}
                  </p>
                  <ul className="space-y-1">
                    {s.candidates.map((candidate) => (
                      <li
                        key={candidate.transactionId}
                        className="rounded-md border border-border/60 px-2 py-1.5"
                      >
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <KindBadge
                            kind={suggestLinkKind(s.out.entitySlug, candidate.entitySlug)}
                          />
                          <p className="min-w-0 flex-1 text-sm">
                            <LegSummary leg={candidate} />
                          </p>
                          <div className="flex shrink-0 gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={isPending}
                              onClick={() =>
                                link(
                                  s.out.transactionId,
                                  candidate.transactionId,
                                  s.kind,
                                  s.refToken,
                                )
                              }
                            >
                              <Check className="mr-1 h-3.5 w-3.5" /> Link
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={isPending}
                              title="Not this one - stop suggesting this pairing"
                              onClick={() => dismiss(s.out.transactionId, candidate.transactionId)}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        <CategoryPreview out={s.out} counterpart={candidate} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {cardError ? (
                <p role="alert" className="mt-1.5 text-xs font-medium text-red-600 dark:text-red-400">
                  {cardError}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
