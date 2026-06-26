"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  acceptAiSuggestions,
  estimateAiRun,
  rejectAiSuggestions,
  requestAiSuggestions,
  type AcceptAiItem,
  type AiEstimateResult,
} from "@/lib/actions/ai-suggestions";
import type { BacklogTransaction, VendorGroup } from "@/lib/ai/vendor-groups";
import { buildVendorGroups } from "@/lib/ai/vendor-groups";
import type { Entity } from "@/lib/types/database";
import { cn, formatCurrency } from "@/lib/utils";

type AiReviewPanelProps = {
  transactions: BacklogTransaction[];
  entities: Pick<Entity, "id" | "name" | "slug">[];
};

type PendingResult = {
  items: Array<{
    tx: BacklogTransaction;
    entityId: string;
    entitySlug: string;
    categoryId: string | null;
    categoryPath: string | null;
    confidence: string;
    rationale: string;
  }>;
  costUsd: number;
  model: string;
};

export function AiReviewPanel({ transactions, entities }: AiReviewPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [pendingResult, setPendingResult] = useState<PendingResult | null>(null);
  const [resultSelectedIds, setResultSelectedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [runConfirm, setRunConfirm] = useState<{ ids: string[]; estimate: AiEstimateResult } | null>(
    null,
  );
  const [isEstimating, setIsEstimating] = useState(false);

  const groups = useMemo(() => buildVendorGroups(transactions), [transactions]);
  const entityIdBySlug = useMemo(
    () => new Map(entities.map((entity) => [entity.slug, entity.id])),
    [entities],
  );

  const selectedCount = selectedIds.size;
  const withAiCount = transactions.filter((tx) => tx.ai_suggestion).length;
  const allSelected = transactions.length > 0 && selectedCount === transactions.length;
  const someSelected = selectedCount > 0 && !allSelected;

  function selectAll(checked: boolean) {
    setSelectedIds(checked ? new Set(transactions.map((tx) => tx.id)) : new Set());
  }

  function toggleGroupExpand(key: string) {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleTransaction(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleGroupSelection(group: VendorGroup, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const tx of group.transactions) {
        if (checked) next.add(tx.id);
        else next.delete(tx.id);
      }
      return next;
    });
  }

  function isGroupFullySelected(group: VendorGroup) {
    return group.transactions.every((tx) => selectedIds.has(tx.id));
  }

  function isGroupPartiallySelected(group: VendorGroup) {
    const selected = group.transactions.filter((tx) => selectedIds.has(tx.id)).length;
    return selected > 0 && selected < group.transactions.length;
  }

  function beginRunAi(selectedOnly: boolean) {
    const ids = selectedOnly ? [...selectedIds] : transactions.map((tx) => tx.id);
    if (ids.length === 0) {
      setError("Select at least one transaction");
      return;
    }

    setError(null);
    setStatus(null);
    setIsEstimating(true);
    setRunConfirm(null);

    startTransition(async () => {
      const estimate = await estimateAiRun(ids);
      setIsEstimating(false);
      if ("error" in estimate) {
        setError(estimate.error);
        return;
      }
      setRunConfirm({ ids, estimate });
    });
  }

  function cancelRunConfirm() {
    setRunConfirm(null);
    setIsEstimating(false);
  }

  function confirmRunAi() {
    if (!runConfirm) return;
    const { ids } = runConfirm;
    setRunConfirm(null);

    startTransition(async () => {
      setStatus(`Running AI on ${ids.length} transaction(s)…`);

      const result = await requestAiSuggestions(ids);
      if ("error" in result) {
        setError(result.error);
        setStatus(null);
        return;
      }

      setStatus(
        `Done — ${result.processed} suggestions · ${result.inputTokens + result.outputTokens} tokens · $${result.costUsd.toFixed(2)} (${result.model})`,
      );
      router.refresh();
    });
  }

  function openResultReview(group: VendorGroup) {
    const items = group.transactions
      .filter((tx) => tx.ai_suggestion && selectedIds.has(tx.id))
      .map((tx) => {
        const ai = tx.ai_suggestion!;
        const entityId = entityIdBySlug.get(ai.entity_slug) ?? entityIdBySlug.get("personal") ?? "";
        return {
          tx,
          entityId,
          entitySlug: ai.entity_slug,
          categoryId: ai.suggested_category_id,
          categoryPath: ai.suggested_category_path,
          confidence: ai.confidence,
          rationale: ai.rationale,
        };
      });

    if (items.length === 0) {
      setError("No AI suggestions for selected transactions in this group — run Ask AI first");
      return;
    }

    setPendingResult({ items, costUsd: 0, model: "" });
    setResultSelectedIds(new Set(items.map((item) => item.tx.id)));
    setError(null);
  }

  function toggleResultTx(id: string) {
    setResultSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleAcceptResult() {
    if (!pendingResult) return;
    const acceptItems: AcceptAiItem[] = pendingResult.items
      .filter((item) => resultSelectedIds.has(item.tx.id) && item.categoryId)
      .map((item) => ({
        classificationId: item.tx.classification_id,
        transactionId: item.tx.id,
        entityId: item.entityId,
        categoryId: item.categoryId,
        description: item.tx.description,
        vendor: item.tx.vendor,
      }));

    if (acceptItems.length === 0) {
      setError("Select transactions with a valid AI category to accept");
      return;
    }

    startTransition(async () => {
      const result = await acceptAiSuggestions(acceptItems);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setPendingResult(null);
      setStatus(`Accepted AI suggestion for ${result.count} transaction(s)`);
      router.refresh();
    });
  }

  function handleRejectResult() {
    if (!pendingResult) return;
    const ids = pendingResult.items.filter((item) => resultSelectedIds.has(item.tx.id)).map((item) => item.tx.id);
    startTransition(async () => {
      await rejectAiSuggestions(ids);
      setPendingResult(null);
      setStatus(`Rejected AI suggestions for ${ids.length} transaction(s)`);
      router.refresh();
    });
  }

  if (transactions.length === 0) {
    return null;
  }

  return (
    <section className="space-y-4 rounded-2xl border border-violet-500/30 bg-gradient-to-br from-violet-500/5 via-card to-card p-6 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-500" />
            <h2 className="text-lg font-semibold">AI review · Personal uncategorized</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            {transactions.length} transactions · 2025–2026 · {withAiCount} already have AI suggestions
          </p>
          <p className="text-xs text-muted-foreground">
            Grouped by vendor. Select a few (or use Select all), then Ask AI. Uncheck anything that looks wrong before accepting.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending || isEstimating || selectedCount === 0}
            onClick={() => beginRunAi(true)}
          >
            Ask AI ({selectedCount})
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isPending || isEstimating}
            onClick={() => beginRunAi(false)}
          >
            Ask AI (all {transactions.length})
          </Button>
        </div>
      </div>

      {status ? <p className="text-sm text-muted-foreground">{status}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border accent-primary"
            checked={allSelected}
            ref={(input) => {
              if (input) input.indeterminate = someSelected;
            }}
            onChange={(event) => selectAll(event.target.checked)}
            aria-label="Select all transactions"
          />
          Select all
        </label>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {selectedCount > 0 ? (
            <span className="text-muted-foreground tabular-nums">
              {selectedCount} of {transactions.length} selected
            </span>
          ) : (
            <span className="text-muted-foreground">None selected</span>
          )}
          {selectedCount > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-auto px-0 text-primary underline-offset-4 hover:underline"
              onClick={() => selectAll(false)}
            >
              Unselect all
            </Button>
          ) : transactions.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-auto px-0 text-primary underline-offset-4 hover:underline"
              onClick={() => selectAll(true)}
            >
              Select all
            </Button>
          ) : null}
        </div>
      </div>

      <div className="max-h-[480px] space-y-2 overflow-y-auto rounded-xl border border-border bg-card/60 p-2">
        {groups.map((group) => {
          const expanded = expandedGroups.has(group.vendorKey);
          const fullySelected = isGroupFullySelected(group);
          const partiallySelected = isGroupPartiallySelected(group);
          const groupSelectedCount = group.transactions.filter((tx) => selectedIds.has(tx.id)).length;
          const hasAi = group.transactions.some((tx) => tx.ai_suggestion);

          return (
            <div key={group.vendorKey} className="rounded-lg border border-border/80 bg-background/80">
              <div className="flex flex-wrap items-center gap-3 px-3 py-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border"
                  checked={fullySelected}
                  ref={(el) => {
                    if (el) el.indeterminate = partiallySelected;
                  }}
                  onChange={(event) => toggleGroupSelection(group, event.target.checked)}
                  aria-label={`Select all ${group.label}`}
                />
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  onClick={() => toggleGroupExpand(group.vendorKey)}
                >
                  {expanded ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate font-medium">{group.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {groupSelectedCount}/{group.transactions.length} selected · {formatCurrency(group.total)}
                  </span>
                </button>
                {hasAi ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={isPending || groupSelectedCount === 0}
                    onClick={() => openResultReview(group)}
                  >
                    Review AI
                  </Button>
                ) : null}
              </div>

              {expanded ? (
                <ul className="divide-y divide-border border-t border-border">
                  {group.transactions.map((tx) => (
                    <li key={tx.id} className="flex items-start gap-3 px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 rounded border-border"
                        checked={selectedIds.has(tx.id)}
                        onChange={() => toggleTransaction(tx.id)}
                        aria-label={`Select ${tx.description}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{tx.description}</p>
                        <p className="text-xs text-muted-foreground">
                          {tx.transaction_date} · {tx.account_display_name} · {formatCurrency(Number(tx.amount))}
                        </p>
                        {tx.ai_suggestion ? (
                          <p className="mt-1 text-xs text-violet-600 dark:text-violet-400">
                            AI: {tx.ai_suggestion.entity_slug}
                            {tx.ai_suggestion.suggested_category_path
                              ? ` → ${tx.ai_suggestion.suggested_category_path}`
                              : " → unsure"}{" "}
                            · {tx.ai_suggestion.confidence}
                          </p>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>

      <Dialog
        open={isEstimating || runConfirm !== null}
        onOpenChange={(open) => {
          if (!open) cancelRunConfirm();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Run AI pre-classifier?</DialogTitle>
            <DialogDescription>
              Suggestions only — nothing is written to the ledger until you accept in review.
            </DialogDescription>
          </DialogHeader>

          {isEstimating ? (
            <p className="text-sm text-muted-foreground">Calculating cost estimate…</p>
          ) : runConfirm ? (
            <div className="space-y-4">
              <dl className="grid gap-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Transactions</dt>
                  <dd className="font-medium tabular-nums">{runConfirm.estimate.transactionCount}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">API batches</dt>
                  <dd className="font-medium tabular-nums">{runConfirm.estimate.batchCount}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Est. tokens</dt>
                  <dd className="font-medium tabular-nums">
                    ~{(runConfirm.estimate.estimatedInputTokens + runConfirm.estimate.estimatedOutputTokens).toLocaleString()}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Model</dt>
                  <dd className="font-medium">{runConfirm.estimate.model}</dd>
                </div>
                <div className="flex justify-between gap-4 border-t border-border pt-2">
                  <dt className="font-medium">Estimated cost</dt>
                  <dd className="text-lg font-semibold tabular-nums">
                    ~${runConfirm.estimate.estimatedCostUsd.toFixed(2)}
                  </dd>
                </div>
              </dl>
              <p className="text-xs text-muted-foreground">
                Actual cost may differ slightly. Final charge appears when the run completes.
              </p>
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" onClick={cancelRunConfirm}>
                  Cancel
                </Button>
                <Button type="button" disabled={isPending} onClick={confirmRunAi}>
                  Run AI (~${runConfirm.estimate.estimatedCostUsd.toFixed(2)})
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {pendingResult ? (
        <div className="space-y-4 rounded-xl border border-violet-500/40 bg-violet-500/5 p-4">
          <h3 className="font-medium">Confirm AI suggestions</h3>
          <p className="text-xs text-muted-foreground">
            Uncheck any transaction before accepting. Entity changes are applied only when you confirm.
          </p>
          <ul className="max-h-64 space-y-2 overflow-y-auto">
            {pendingResult.items.map((item) => (
              <li
                key={item.tx.id}
                className={cn(
                  "flex items-start gap-3 rounded-lg border border-border bg-card p-3 text-sm",
                  !resultSelectedIds.has(item.tx.id) && "opacity-50",
                )}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4"
                  checked={resultSelectedIds.has(item.tx.id)}
                  onChange={() => toggleResultTx(item.tx.id)}
                />
                <div>
                  <p className="font-medium">{item.tx.description}</p>
                  <p className="text-xs text-muted-foreground">{item.rationale}</p>
                  <p className="mt-1 text-xs">
                    → <span className="font-medium">{item.entitySlug}</span>
                    {item.categoryPath ? ` · ${item.categoryPath}` : " · unsure (pick manually)"}
                    {" · "}
                    {item.confidence}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={isPending} onClick={handleAcceptResult}>
              Accept selected ({pendingResult.items.filter((i) => resultSelectedIds.has(i.tx.id) && i.categoryId).length})
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={handleRejectResult}>
              Reject selected
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setPendingResult(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
