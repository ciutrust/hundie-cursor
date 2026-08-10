"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Unlink } from "lucide-react";
import { formatBillDate } from "@/components/bills/format";
import { Button } from "@/components/ui/button";
import { unlinkIntercompanyPair } from "@/lib/actions/intercompany";
import { formatCurrency } from "@/lib/utils";
import type { LinkKind, LinkedPair } from "@/lib/queries/intercompany";

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

/** Why the link stopped holding - bank reversed a leg, a leg got split, or the amounts drifted. */
const BROKEN_LABELS: Record<NonNullable<LinkedPair["brokenReason"]>, string> = {
  removed: "Leg reversed by bank",
  split: "Leg was split",
  "amount-drift": "Amounts no longer match",
};

/** createdAt is a full timestamp; formatBillDate only speaks YYYY-MM-DD. */
function formatCreatedAt(iso: string) {
  return formatBillDate(iso.slice(0, 10));
}

export type LinkedPairsProps = {
  pairs: LinkedPair[];
};

/**
 * Pairs already linked - the ledger's proof that both legs of each transfer are accounted for.
 * Unlink is one click (reversible, the suggestion just comes back), and broken links are
 * surfaced loudly because a link that no longer holds is a double-count waiting to happen.
 */
export function LinkedPairs({ pairs }: LinkedPairsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const visible = pairs.filter((pair) => !removed.has(pair.linkId));

  const unlink = (linkId: string) =>
    startTransition(async () => {
      const result = await unlinkIntercompanyPair({ linkId });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setError(null);
      setRemoved((prev) => new Set(prev).add(linkId));
      router.refresh();
    });

  if (visible.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        No linked pairs in this period.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Kind</th>
              <th className="px-4 py-3 font-medium">Entities</th>
              <th className="px-4 py-3 text-right font-medium">Amount</th>
              <th className="px-4 py-3 font-medium">Ref</th>
              <th className="px-4 py-3 font-medium">Linked</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visible.map((pair) => {
              const sameDay = pair.out.transactionDate === pair.in.transactionDate;
              const drift = pair.brokenReason === "amount-drift";
              return (
                <tr
                  key={pair.linkId}
                  className={pair.broken ? "bg-amber-500/5" : "hover:bg-muted/20"}
                >
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums">
                    {pair.out.transactionDate}
                    {sameDay ? "" : ` → ${pair.in.transactionDate}`}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${KIND_BADGE_CLASSES[pair.kind]}`}
                    >
                      {KIND_LABELS[pair.kind]}
                    </span>
                  </td>
                  <td
                    className="whitespace-nowrap px-4 py-3"
                    title={`${pair.out.description} (account ${pair.out.accountId}) → ${pair.in.description} (account ${pair.in.accountId})`}
                  >
                    <span className="font-medium">{pair.out.entitySlug}</span>
                    <span className="mx-1.5 text-muted-foreground">→</span>
                    <span className="font-medium">{pair.in.entitySlug}</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                    {drift
                      ? `${formatCurrency(Math.abs(pair.out.amount))} → ${formatCurrency(Math.abs(pair.in.amount))}`
                      : formatCurrency(Math.abs(pair.out.amount))}
                  </td>
                  <td className="px-4 py-3">
                    {pair.refToken ? (
                      <span
                        className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                        title="Wells Fargo stamps the same reference on both legs - this is the same transfer"
                      >
                        {pair.refToken}
                      </span>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                    {formatCreatedAt(pair.createdAt)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {pair.broken ? (
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                        {pair.brokenReason ? BROKEN_LABELS[pair.brokenReason] : "Link broken"}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      title="Unlink - both legs go back to being suggestions"
                      onClick={() => unlink(pair.linkId)}
                    >
                      <Unlink className="mr-1 h-3.5 w-3.5" /> Unlink
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {error ? (
        <p role="alert" className="text-sm font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
