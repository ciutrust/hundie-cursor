"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
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
import { Input } from "@/components/ui/input";
import {
  acceptAiSuggestions,
  estimateAiRun,
  requestAiSuggestions,
  type AcceptAiItem,
  type AiEstimateResult,
} from "@/lib/actions/ai-suggestions";
import { AI_BATCH_SIZE } from "@/lib/ai/config";
import { buildVendorGroupPackages } from "@/lib/ai/vendor-group-packages";
import type { BacklogTransaction, VendorGroup } from "@/lib/ai/vendor-groups";
import { buildVendorGroups } from "@/lib/ai/vendor-groups";
import type { Entity } from "@/lib/types/database";
import { formatCurrency } from "@/lib/utils";

type AiReviewPanelProps = {
  transactions: BacklogTransaction[];
  entities: Pick<Entity, "id" | "name" | "slug">[];
};

type HasAiFilter = "all" | "yes" | "no";

export function AiReviewPanel({ transactions, entities }: AiReviewPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [askSelectedIds, setAskSelectedIds] = useState<Set<string>>(() => new Set());
  const [acceptIncludedIds, setAcceptIncludedIds] = useState<Set<string>>(() => new Set());
  const [vendorSearch, setVendorSearch] = useState("");
  const [hasAiFilter, setHasAiFilter] = useState<HasAiFilter>("all");
  const [accountFilter, setAccountFilter] = useState("all");
  const [confidenceFilter, setConfidenceFilter] = useState("all");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [runConfirm, setRunConfirm] = useState<{ ids: string[]; estimate: AiEstimateResult } | null>(
    null,
  );
  const [isEstimating, setIsEstimating] = useState(false);

  const entityIdBySlug = useMemo(
    () => new Map(entities.map((entity) => [entity.slug, entity.id])),
    [entities],
  );

  const groups = useMemo(() => buildVendorGroups(transactions), [transactions]);

  const accountOptions = useMemo(() => {
    const accounts = new Set(transactions.map((tx) => tx.account_display_name));
    return [...accounts].sort();
  }, [transactions]);

  const filteredGroups = useMemo(() => {
    const query = vendorSearch.trim().toLowerCase();
    return groups.filter((group) => {
      if (query && !group.label.toLowerCase().includes(query)) return false;
      const groupHasAi = group.transactions.some((tx) => tx.ai_suggestion);
      if (hasAiFilter === "yes" && !groupHasAi) return false;
      if (hasAiFilter === "no" && groupHasAi) return false;
      if (accountFilter !== "all") {
        if (!group.transactions.some((tx) => tx.account_display_name === accountFilter)) return false;
      }
      if (confidenceFilter !== "all") {
        if (
          !group.transactions.some((tx) => tx.ai_suggestion?.confidence === confidenceFilter)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [groups, vendorSearch, hasAiFilter, accountFilter, confidenceFilter]);

  const withAiCount = transactions.filter((tx) => tx.ai_suggestion).length;
  const askSelectedCount = askSelectedIds.size;

  useEffect(() => {
    setAcceptIncludedIds(
      new Set(transactions.filter((tx) => tx.ai_suggestion).map((tx) => tx.id)),
    );
  }, [transactions]);

  function toggleGroupExpand(key: string) {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAskSelection(id: string) {
    setAskSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAskGroupSelection(group: VendorGroup, checked: boolean) {
    setAskSelectedIds((current) => {
      const next = new Set(current);
      for (const tx of group.transactions) {
        if (checked) next.add(tx.id);
        else next.delete(tx.id);
      }
      return next;
    });
  }

  function toggleAcceptInclusion(id: string) {
    setAcceptIncludedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function isAskGroupFullySelected(group: VendorGroup) {
    return group.transactions.every((tx) => askSelectedIds.has(tx.id));
  }

  function isAskGroupPartiallySelected(group: VendorGroup) {
    const n = group.transactions.filter((tx) => askSelectedIds.has(tx.id)).length;
    return n > 0 && n < group.transactions.length;
  }

  function beginRunAi(selectedOnly: boolean) {
    const ids = selectedOnly ? [...askSelectedIds] : transactions.map((tx) => tx.id);
    if (ids.length === 0) {
      setError("Select at least one transaction for Ask AI");
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
    setError(null);

    const selectedTxs = transactions.filter((tx) => ids.includes(tx.id));
    const packages = buildVendorGroupPackages(selectedTxs);

    startTransition(async () => {
      let totalProcessed = 0;
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let totalCostUsd = 0;
      let model = "";

      try {
        for (let i = 0; i < packages.length; i += AI_BATCH_SIZE) {
          const batchPackages = packages.slice(i, i + AI_BATCH_SIZE);
          const batchIds = batchPackages.flatMap((pkg) => pkg.transaction_ids);
          const batchNum = Math.floor(i / AI_BATCH_SIZE) + 1;
          const batchTotal = Math.ceil(packages.length / AI_BATCH_SIZE);

          setStatus(`Running AI on vendor groups ${batchNum} of ${batchTotal}…`);

          const result = await requestAiSuggestions(batchIds);
          if ("error" in result) {
            const partial =
              totalProcessed > 0 ? ` ${totalProcessed} suggestion(s) saved before failure.` : "";
            setError(`${result.error}${partial}`);
            setStatus(null);
            return;
          }

          totalProcessed += result.processed;
          totalInputTokens += result.inputTokens;
          totalOutputTokens += result.outputTokens;
          totalCostUsd += result.costUsd;
          model = result.model;
        }

        setStatus(
          `Done — ${totalProcessed} suggestions · ${packages.length} vendor groups · ${totalInputTokens + totalOutputTokens} tokens · $${totalCostUsd.toFixed(2)} (${model})`,
        );
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "AI run failed unexpectedly");
        setStatus(null);
      }
    });
  }

  function acceptGroupAi(group: VendorGroup) {
    const acceptItems: AcceptAiItem[] = group.transactions
      .filter(
        (tx) =>
          acceptIncludedIds.has(tx.id) &&
          tx.ai_suggestion?.suggested_category_id &&
          tx.ai_suggestion.entity_slug,
      )
      .map((tx) => {
        const ai = tx.ai_suggestion!;
        const entityId =
          entityIdBySlug.get(ai.entity_slug) ?? entityIdBySlug.get("personal") ?? "";
        return {
          classificationId: tx.classification_id,
          transactionId: tx.id,
          entityId,
          categoryId: ai.suggested_category_id,
          description: tx.description,
          vendor: tx.vendor,
        };
      });

    if (acceptItems.length === 0) {
      setError("No checked transactions with a valid AI category in this group");
      return;
    }

    setError(null);
    startTransition(async () => {
      const result = await acceptAiSuggestions(acceptItems);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setStatus(`Accepted AI for ${result.count} transaction(s) in ${group.label}`);
      router.refresh();
    });
  }

  if (transactions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No Personal uncategorized transactions in the AI backlog.</p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-500" />
            <h2 className="text-lg font-semibold">Vendor groups</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            {transactions.length} transactions · {withAiCount} with AI suggestions · classified by vendor group
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending || isEstimating || askSelectedCount === 0}
            onClick={() => beginRunAi(true)}
          >
            Ask AI ({askSelectedCount})
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isPending || isEstimating}
            onClick={() => beginRunAi(false)}
          >
            Ask AI (all)
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Input
          type="search"
          placeholder="Filter vendors…"
          value={vendorSearch}
          onChange={(event) => setVendorSearch(event.target.value)}
        />
        <select
          className="h-10 rounded-md border border-border bg-background px-3 text-sm"
          value={hasAiFilter}
          onChange={(event) => setHasAiFilter(event.target.value as HasAiFilter)}
        >
          <option value="all">All AI status</option>
          <option value="yes">Has AI suggestion</option>
          <option value="no">No AI yet</option>
        </select>
        <select
          className="h-10 rounded-md border border-border bg-background px-3 text-sm"
          value={accountFilter}
          onChange={(event) => setAccountFilter(event.target.value)}
        >
          <option value="all">All accounts</option>
          {accountOptions.map((account) => (
            <option key={account} value={account}>
              {account}
            </option>
          ))}
        </select>
        <select
          className="h-10 rounded-md border border-border bg-background px-3 text-sm"
          value={confidenceFilter}
          onChange={(event) => setConfidenceFilter(event.target.value)}
        >
          <option value="all">All confidence</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>

      {status ? <p className="text-sm text-muted-foreground">{status}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="space-y-2">
        {filteredGroups.length === 0 ? (
          <p className="text-sm text-muted-foreground">No vendor groups match your filters.</p>
        ) : (
          filteredGroups.map((group) => {
            const expanded = expandedGroups.has(group.vendorKey);
            const hasAi = group.transactions.some((tx) => tx.ai_suggestion);
            const aiSample = group.transactions.find((tx) => tx.ai_suggestion)?.ai_suggestion;
            const acceptCount = group.transactions.filter(
              (tx) => acceptIncludedIds.has(tx.id) && tx.ai_suggestion?.suggested_category_id,
            ).length;

            return (
              <div key={group.vendorKey} className="rounded-lg border border-border bg-card">
                <div className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border"
                    title="Select for Ask AI"
                    checked={isAskGroupFullySelected(group)}
                    ref={(el) => {
                      if (el) el.indeterminate = isAskGroupPartiallySelected(group);
                    }}
                    onChange={(event) => toggleAskGroupSelection(group, event.target.checked)}
                    aria-label={`Select ${group.label} for Ask AI`}
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
                      {group.transactions.length} txns · {formatCurrency(group.total)}
                    </span>
                  </button>
                  {hasAi && aiSample ? (
                    <span className="hidden text-xs text-violet-600 dark:text-violet-400 lg:inline">
                      AI: {aiSample.entity_slug}
                      {aiSample.suggested_category_path
                        ? ` → ${aiSample.suggested_category_path}`
                        : ""}{" "}
                      · {aiSample.confidence}
                    </span>
                  ) : null}
                  {hasAi ? (
                    <Button
                      type="button"
                      size="sm"
                      disabled={isPending || acceptCount === 0}
                      onClick={() => acceptGroupAi(group)}
                    >
                      Accept AI ({acceptCount})
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
                          title="Select for Ask AI"
                          checked={askSelectedIds.has(tx.id)}
                          onChange={() => toggleAskSelection(tx.id)}
                        />
                        {tx.ai_suggestion ? (
                          <input
                            type="checkbox"
                            className="mt-0.5 h-4 w-4 rounded border-border accent-violet-500"
                            title="Include in Accept AI"
                            checked={acceptIncludedIds.has(tx.id)}
                            onChange={() => toggleAcceptInclusion(tx.id)}
                          />
                        ) : (
                          <span className="mt-0.5 w-4" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{tx.description}</p>
                          <p className="text-xs text-muted-foreground">
                            {tx.transaction_date} · {tx.account_display_name} ·{" "}
                            {formatCurrency(Number(tx.amount))}
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
          })
        )}
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
              Vendor groups are summarized (not sent row-by-row). Nothing writes to the ledger until you
              Accept AI.
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
                  <dt className="text-muted-foreground">Vendor groups</dt>
                  <dd className="font-medium tabular-nums">{runConfirm.estimate.vendorGroupCount}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">API batches</dt>
                  <dd className="font-medium tabular-nums">{runConfirm.estimate.batchCount}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Est. tokens</dt>
                  <dd className="font-medium tabular-nums">
                    ~{(
                      runConfirm.estimate.estimatedInputTokens + runConfirm.estimate.estimatedOutputTokens
                    ).toLocaleString()}
                  </dd>
                </div>
                <div className="flex justify-between gap-4 border-t border-border pt-2">
                  <dt className="font-medium">Estimated cost</dt>
                  <dd className="text-lg font-semibold tabular-nums">
                    ~${runConfirm.estimate.estimatedCostUsd.toFixed(2)}
                  </dd>
                </div>
              </dl>
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
    </div>
  );
}
