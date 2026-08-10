"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { acknowledgeOneSidedLeg, setPairLegCategory, unacknowledgeOneSidedLeg } from "@/lib/actions/intercompany";
import { formatCurrency } from "@/lib/utils";
import type { PairLeg } from "@/lib/queries/intercompany";
import type { EntityCategoryOption } from "@/components/intercompany/linked-pairs";

export type OneSidedLegsProps = {
  legs: PairLeg[];
  categoriesByEntity: Record<string, EntityCategoryOption[]>;
  entityNames: Record<string, string>;
};

/**
 * The "money left and never arrived" audit list, grouped by entity, with the two resolution
 * paths built in:
 *  - the row is miscategorized: fix the category right here (entity-scoped options, server
 *    re-validates), which usually drops it from pairing relevance;
 *  - the counterpart lives in an account Hundie doesn't track: acknowledge it (with an optional
 *    note) and it stops nagging - undo is offered inline right after.
 * The third path - a genuinely missing pair - resolves up in Suggested pairs, not here.
 */
export function OneSidedLegs({ legs, categoriesByEntity, entityNames }: OneSidedLegsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [acked, setAcked] = useState<Set<string>>(new Set());
  const [lastAckedId, setLastAckedId] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const visible = legs.filter((leg) => !acked.has(leg.transactionId));

  const grouped = [
    ...visible.reduce((groups, leg) => {
      const list = groups.get(leg.entitySlug) ?? [];
      list.push(leg);
      groups.set(leg.entitySlug, list);
      return groups;
    }, new Map<string, PairLeg[]>()),
  ];

  const changeCategory = (transactionId: string, categoryId: string | null) =>
    startTransition(async () => {
      const result = await setPairLegCategory({ transactionId, categoryId });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setError(null);
      router.refresh();
    });

  const acknowledge = (transactionId: string) =>
    startTransition(async () => {
      const result = await acknowledgeOneSidedLeg({
        transactionId,
        note: noteDrafts[transactionId] ?? "",
      });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setError(null);
      setAcked((prev) => new Set(prev).add(transactionId));
      setLastAckedId(transactionId);
      router.refresh();
    });

  const undoAcknowledge = (transactionId: string) =>
    startTransition(async () => {
      const result = await unacknowledgeOneSidedLeg({ transactionId });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setError(null);
      setAcked((prev) => {
        const next = new Set(prev);
        next.delete(transactionId);
        return next;
      });
      setLastAckedId(null);
      router.refresh();
    });

  if (visible.length === 0 && !lastAckedId) return null;

  return (
    <div className="space-y-3">
      {grouped.map(([slug, groupLegs]) => (
        <div key={slug} className="space-y-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {entityNames[slug] ?? slug} · {groupLegs.length}
          </h3>
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <ul className="divide-y divide-border">
              {groupLegs.map((leg) => (
                <li key={leg.transactionId} className="space-y-2 px-4 py-2.5 text-sm">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="tabular-nums text-muted-foreground">
                      {leg.transactionDate}
                    </span>
                    <span
                      className="min-w-0 flex-1 truncate text-muted-foreground"
                      title={leg.description}
                    >
                      {leg.description}
                    </span>
                    <span className="tabular-nums font-medium">{formatCurrency(leg.amount)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={leg.categoryId ?? ""}
                      disabled={isPending}
                      onChange={(event) =>
                        changeCategory(
                          leg.transactionId,
                          event.target.value === "" ? null : event.target.value,
                        )
                      }
                      aria-label="Category"
                      className="max-w-72 rounded-md border border-border bg-card px-2 py-1.5 text-sm"
                    >
                      <option value="">Uncategorized</option>
                      {(categoriesByEntity[leg.entitySlug] ?? []).map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.full_path}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={noteDrafts[leg.transactionId] ?? ""}
                      disabled={isPending}
                      placeholder="Note (optional) - where the other side lives…"
                      onChange={(event) =>
                        setNoteDrafts((prev) => ({
                          ...prev,
                          [leg.transactionId]: event.target.value,
                        }))
                      }
                      className="min-w-0 flex-1 rounded-md border border-border bg-card px-2 py-1.5 text-sm"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isPending}
                      title="The counterpart isn't tracked in Hundie - resolve this leg"
                      onClick={() => acknowledge(leg.transactionId)}
                    >
                      <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Not tracked here
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ))}

      {lastAckedId ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          Leg acknowledged.
          <button
            type="button"
            disabled={isPending}
            onClick={() => undoAcknowledge(lastAckedId)}
            className="inline-flex items-center gap-1 underline underline-offset-4 hover:text-foreground"
          >
            <Undo2 className="h-3 w-3" /> Undo
          </button>
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
