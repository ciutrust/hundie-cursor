"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CategorySearchSelect } from "@/components/review/category-search-select";
import { CategorySuggestionChips } from "@/components/review/category-suggestion-chips";
import { TransactionSearchBar } from "@/components/review/transaction-search-bar";
import { bulkReclassifyTransactions, reclassifyTransaction } from "@/lib/actions/reclassify";
import type { SuggestionOutcome } from "@/lib/actions/suggestion-events";
import { getAiCategorySuggestion } from "@/lib/actions/ai-category-suggestion";
import { getBulkCategorySuggestions, getCategorySuggestions } from "@/lib/actions/suggestions";
import type { CategorySuggestion } from "@/lib/suggestions/category-suggestions";
import type { Category, Entity, TransactionWithDetails } from "@/lib/types/database";
import {
  EMPTY_TRANSACTION_FILTERS,
  filterTransactions,
  getAccountFilterOptions,
  getCategoryFilterOptions,
  isReviewBacklogTransaction,
  transactionVendorKey,
  type TransactionFilterState,
} from "@/lib/transaction-filters";
import { cn, formatCurrency } from "@/lib/utils";

type EntityCategory = Pick<Category, "id" | "full_path">;

type TransactionListProps = {
  transactions: TransactionWithDetails[];
  entities: Pick<Entity, "id" | "name" | "slug">[];
  categories: EntityCategory[];
  categoriesByEntity: Record<string, EntityCategory[]>;
  month: string;
  entitySlug: string;
  /** Transaction ids with a stored AI suggestion — shows violet badge in list */
  aiSuggestionTxIds?: Set<string>;
};

export function TransactionList({
  transactions,
  entities,
  categories,
  categoriesByEntity,
  month,
  entitySlug,
  aiSuggestionTxIds,
}: TransactionListProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailTransaction, setDetailTransaction] = useState<TransactionWithDetails | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [filters, setFilters] = useState<TransactionFilterState>(EMPTY_TRANSACTION_FILTERS);

  const [sortKey, setSortKey] = useState<"date" | "name" | "amount">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const filteredTransactions = useMemo(
    () => filterTransactions(transactions, filters),
    [transactions, filters],
  );

  const sortedTransactions = useMemo(() => {
    const arr = [...filteredTransactions];
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "date") cmp = a.transaction_date.localeCompare(b.transaction_date);
      else if (sortKey === "name") cmp = (a.description ?? "").localeCompare(b.description ?? "");
      else cmp = Math.abs(Number(a.amount)) - Math.abs(Number(b.amount));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filteredTransactions, sortKey, sortDir]);

  const filteredTotal = useMemo(
    () => filteredTransactions.reduce((sum, tx) => sum + Number(tx.amount), 0),
    [filteredTransactions],
  );

  const categoryOptions = useMemo(
    () => getCategoryFilterOptions(transactions, categories),
    [transactions, categories],
  );

  const accountOptions = useMemo(
    () => getAccountFilterOptions(transactions),
    [transactions],
  );

  useEffect(() => {
    setSelectedIds((current) => {
      const visibleIds = new Set(filteredTransactions.map((tx) => tx.id));
      const next = new Set([...current].filter((id) => visibleIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [filteredTransactions]);

  const defaultEntityId = useMemo(() => {
    if (entitySlug === "unclassified") {
      return entities.find((entity) => entity.slug === "gbsl")?.id ?? entities[0]?.id ?? "";
    }
    return entities.find((entity) => entity.slug === entitySlug)?.id ?? entities[0]?.id ?? "";
  }, [entities, entitySlug]);

  const selectedTransactions = useMemo(
    () => filteredTransactions.filter((tx) => selectedIds.has(tx.id)),
    [filteredTransactions, selectedIds],
  );

  const selectedTotal = useMemo(
    () => selectedTransactions.reduce((sum, tx) => sum + Number(tx.amount), 0),
    [selectedTransactions],
  );

  const allSelected =
    filteredTransactions.length > 0 && selectedIds.size === filteredTransactions.length;
  const someSelected = selectedIds.size > 0 && !allSelected;
  const reviewBacklogCount = useMemo(
    () => transactions.filter(isReviewBacklogTransaction).length,
    [transactions],
  );
  const reviewBacklogFilterActive = filters.reviewBacklogOnly;

  function toggleOne(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(filteredTransactions.map((tx) => tx.id)));
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  // A: "Find similar" — narrow to the same vendor and select them all for bulk assign.
  function findSimilar(tx: TransactionWithDetails) {
    const key = transactionVendorKey(tx);
    if (!key) return; // no extractable vendor token — nothing meaningful to match
    const matches = transactions.filter((candidate) => transactionVendorKey(candidate) === key);
    setFilters({ ...EMPTY_TRANSACTION_FILTERS, similarVendorKey: key });
    setSelectedIds(new Set(matches.map((candidate) => candidate.id)));
  }

  function clearSimilar() {
    setFilters((current) => ({ ...current, similarVendorKey: null }));
  }

  function handleBulkComplete() {
    setBulkOpen(false);
    clearSelection();
    // After assigning a batch (e.g. a Find-similar set), drop the filters so the view snaps back
    // to the full list instead of getting stuck on a now-empty filtered set.
    setFilters(EMPTY_TRANSACTION_FILTERS);
  }

  if (transactions.length === 0) {
    return (
      <div className="space-y-3">
        <TransactionSearchBar
          filters={filters}
          onChange={setFilters}
          resultCount={0}
          totalCount={0}
          categoryOptions={getCategoryFilterOptions([], categories)}
          accountOptions={[]}
        />
        <p className="text-sm text-muted-foreground">No transactions for this view.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <TransactionSearchBar
        filters={filters}
        onChange={setFilters}
        resultCount={filteredTransactions.length}
        totalCount={transactions.length}
        categoryOptions={categoryOptions}
        accountOptions={accountOptions}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={allSelected}
              ref={(input) => {
                if (input) input.indeterminate = someSelected;
              }}
              onChange={toggleAll}
              className="h-4 w-4 rounded border-border accent-primary"
            />
            Select all
          </label>
          {reviewBacklogCount > 0 ? (
            <Button
              type="button"
              variant={reviewBacklogFilterActive ? "default" : "outline"}
              size="sm"
              onClick={() =>
                setFilters((current) => ({
                  ...current,
                  reviewBacklogOnly: !current.reviewBacklogOnly,
                }))
              }
            >
              Unclassified & AMA
              {!reviewBacklogFilterActive ? ` (${reviewBacklogCount})` : null}
            </Button>
          ) : null}
          {filters.similarVendorKey ? (
            <Button type="button" variant="default" size="sm" onClick={clearSimilar}>
              Similar: {filters.similarVendorKey} ✕
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted-foreground tabular-nums">
            {filteredTransactions.length} · {formatCurrency(filteredTotal)}
          </span>
          <div className="flex items-center gap-1">
            <select
              value={sortKey}
              onChange={(event) => setSortKey(event.target.value as "date" | "name" | "amount")}
              aria-label="Sort by"
              className="rounded-md border border-border bg-card px-2 py-1.5 text-sm"
            >
              <option value="date">Date</option>
              <option value="name">Name</option>
              <option value="amount">Amount</option>
            </select>
            <button
              type="button"
              onClick={() => setSortDir((dir) => (dir === "asc" ? "desc" : "asc"))}
              aria-label="Toggle sort direction"
              className="rounded-md border border-border bg-card px-2.5 py-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              {sortDir === "asc" ? "↑" : "↓"}
            </button>
          </div>
        </div>
      </div>

      {filteredTransactions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No transactions match your search.</p>
      ) : (
        <>

      <div className="divide-y divide-border rounded-lg border border-border bg-card">
        {sortedTransactions.map((tx) => {
          const isSelected = selectedIds.has(tx.id);

          return (
            <div
              key={tx.id}
              className={cn(
                "flex items-start gap-3 px-4 py-3",
                isSelected && "bg-accent/40",
              )}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => toggleOne(tx.id)}
                aria-label={`Select ${tx.description}`}
                className="mt-1 h-4 w-4 shrink-0 rounded border-border accent-primary"
              />
              <button
                type="button"
                onClick={() => setDetailTransaction(tx)}
                className="flex min-w-0 flex-1 items-start justify-between gap-4 text-left hover:opacity-80"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate font-medium">
                    <span className="truncate">{tx.description}</span>
                    {aiSuggestionTxIds?.has(tx.id) ? (
                      <span
                        className="shrink-0 rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-violet-600 dark:text-violet-400"
                        title="AI suggestion available — open to review"
                      >
                        AI
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {tx.transaction_date} · {tx.account.display_name}
                    {tx.classification.category
                      ? ` · ${tx.classification.category.full_path}`
                      : " · Unclassified"}
                  </p>
                </div>
                <span className="shrink-0 font-medium">{formatCurrency(Number(tx.amount))}</span>
              </button>
              <button
                type="button"
                onClick={() => findSimilar(tx)}
                title="Select all transactions from this vendor for bulk assign"
                className="mt-1 shrink-0 self-center rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                Find similar
              </button>
            </div>
          );
        })}
      </div>

      {selectedIds.size > 0 ? (
        <div className="sticky bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 shadow-md">
          <p className="text-sm font-medium">
            {selectedIds.size} transaction{selectedIds.size === 1 ? "" : "s"} selected ·{" "}
            {formatCurrency(selectedTotal)}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={clearSelection}>
              Clear
            </Button>
            <Button size="sm" onClick={() => setBulkOpen(true)}>
              Assign category
            </Button>
          </div>
        </div>
      ) : null}
        </>
      )}

      {detailTransaction ? (
        <ReclassifyDialog
          transaction={detailTransaction}
          entities={entities}
          categoriesByEntity={categoriesByEntity}
          month={month}
          entitySlug={entitySlug}
          onClose={() => setDetailTransaction(null)}
        />
      ) : null}

      {bulkOpen ? (
        <BulkAssignDialog
          transactions={selectedTransactions}
          entities={entities}
          categoriesByEntity={categoriesByEntity}
          defaultEntityId={defaultEntityId}
          entitySlug={entitySlug}
          onClose={() => setBulkOpen(false)}
          onComplete={handleBulkComplete}
        />
      ) : null}
    </div>
  );
}

type ClassificationFormProps = {
  entities: Pick<Entity, "id" | "name" | "slug">[];
  categoriesByEntity: Record<string, EntityCategory[]>;
  entityId: string;
  categoryId: string | null;
  onEntityChange: (entityId: string) => void;
  onCategoryChange: (categoryId: string | null) => void;
  entityFieldId?: string;
  categoryFieldId?: string;
};

function ClassificationForm({
  entities,
  categoriesByEntity,
  entityId,
  categoryId,
  onEntityChange,
  onCategoryChange,
  entityFieldId = "entity",
  categoryFieldId = "category",
}: ClassificationFormProps) {
  const selectedEntity = entities.find((entity) => entity.id === entityId);
  const entityCategories = selectedEntity ? (categoriesByEntity[selectedEntity.slug] ?? []) : [];
  const showCategories = entityCategories.length > 0;

  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={entityFieldId}>Entity</Label>
        <Select value={entityId} onValueChange={onEntityChange}>
          <SelectTrigger id={entityFieldId}>
            <SelectValue placeholder="Select entity" />
          </SelectTrigger>
          <SelectContent>
            {entities.map((entity) => (
              <SelectItem key={entity.id} value={entity.id}>
                {entity.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {showCategories ? (
        <CategorySearchSelect
          id={categoryFieldId}
          label={`Category (${selectedEntity?.name ?? "Entity"})`}
          categories={entityCategories}
          value={categoryId}
          onChange={onCategoryChange}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          No category chart for {selectedEntity?.name ?? "this entity"} yet. Entity changes save now;
          category stays unclassified.
        </p>
      )}
    </>
  );
}

type ReclassifyDialogProps = {
  transaction: TransactionWithDetails;
  entities: Pick<Entity, "id" | "name" | "slug">[];
  categoriesByEntity: Record<string, EntityCategory[]>;
  month: string;
  entitySlug: string;
  onClose: () => void;
};

function ReclassifyDialog({
  transaction,
  entities,
  categoriesByEntity,
  month,
  entitySlug,
  onClose,
}: ReclassifyDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [entityId, setEntityId] = useState(transaction.classification.entity_id);
  const [categoryId, setCategoryId] = useState<string | null>(transaction.classification.category_id);
  const [notes, setNotes] = useState(transaction.classification.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<CategorySuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);

  const selectedEntity = entities.find((entity) => entity.id === entityId);
  const showCategories = (categoriesByEntity[selectedEntity?.slug ?? ""]?.length ?? 0) > 0;
  const suggestionEntitySlug = selectedEntity?.slug;
  const showSuggestions =
    suggestionEntitySlug === "gbsl" ||
    suggestionEntitySlug === "personal" ||
    suggestionEntitySlug === "acaa-austin" ||
    suggestionEntitySlug === "pflugerville" ||
    suggestionEntitySlug === "keller";

  useEffect(() => {
    if (!showSuggestions || !suggestionEntitySlug) {
      setSuggestions([]);
      setSuggestionsLoading(false);
      setSuggestionsError(null);
      return;
    }

    let cancelled = false;
    setSuggestionsLoading(true);
    setSuggestionsError(null);

    getCategorySuggestions({
      description: transaction.description,
      vendor: transaction.vendor,
      entitySlug: suggestionEntitySlug,
      amount: Number(transaction.amount),
    })
      .then(async (result) => {
        if (cancelled) return;
        const aiSuggestion = await getAiCategorySuggestion(transaction.id);
        const merged = aiSuggestion
          ? [aiSuggestion, ...result.suggestions.filter((s) => s.categoryId !== aiSuggestion.categoryId)]
          : result.suggestions;
        setSuggestions(merged);
        setSuggestionsError(result.error ?? null);
        setSuggestionsLoading(false);
      })
      .catch((fetchError: unknown) => {
        if (cancelled) return;
        setSuggestions([]);
        setSuggestionsError(
          fetchError instanceof Error ? fetchError.message : "Failed to load suggestions",
        );
        setSuggestionsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [showSuggestions, suggestionEntitySlug, transaction.description, transaction.vendor, transaction.id, transaction.amount]);

  function handleEntityChange(nextEntityId: string) {
    setEntityId(nextEntityId);
    const nextEntity = entities.find((entity) => entity.id === nextEntityId);
    const nextHasCategories = (categoriesByEntity[nextEntity?.slug ?? ""]?.length ?? 0) > 0;
    if (!nextHasCategories) {
      setCategoryId(null);
    }
  }

  function buildSuggestionOutcome(chosenCategoryId: string | null): SuggestionOutcome | null {
    if (!showSuggestions || suggestions.length === 0) return null;
    return {
      transactionId: transaction.id,
      classificationId: transaction.classification.id,
      entityId,
      description: transaction.description,
      vendor: transaction.vendor,
      chosenCategoryId,
      suggestionsShown: suggestions.map((item) => ({
        categoryId: item.categoryId,
        source: item.source,
      })),
    };
  }

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await reclassifyTransaction({
        classificationId: transaction.classification.id,
        entityId,
        categoryId: showCategories ? categoryId : null,
        notes,
        month,
        entitySlug,
        suggestionOutcome: buildSuggestionOutcome(showCategories ? categoryId : null),
      });

      if (result.error) {
        setError(result.error);
        return;
      }

      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reclassify transaction</DialogTitle>
          <DialogDescription>{transaction.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md bg-muted p-3 text-sm">
            <p>
              <span className="text-muted-foreground">Amount:</span> {formatCurrency(Number(transaction.amount))}
            </p>
            <p>
              <span className="text-muted-foreground">Date:</span> {transaction.transaction_date}
            </p>
            <p>
              <span className="text-muted-foreground">Account:</span> {transaction.account.display_name}
            </p>
          </div>

          {showSuggestions ? (
            <CategorySuggestionChips
              suggestions={suggestions}
              selectedCategoryId={categoryId}
              isLoading={suggestionsLoading}
              error={suggestionsError}
              entitySlug={suggestionEntitySlug}
              onSelect={setCategoryId}
            />
          ) : null}

          <ClassificationForm
            entities={entities}
            categoriesByEntity={categoriesByEntity}
            entityId={entityId}
            categoryId={categoryId}
            onEntityChange={handleEntityChange}
            onCategoryChange={setCategoryId}
          />

          <div className="space-y-2">
            <Label htmlFor="classification-notes">Notes</Label>
            <textarea
              id="classification-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Why is this categorized this way? Context for export or CPA review."
              rows={3}
              className="flex min-h-[80px] w-full rounded-md border border-border bg-card px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
            <p className="text-xs text-muted-foreground">
              Saved with this transaction for export and review later.
            </p>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isPending}>
              {isPending ? "Saving…" : "Save classification"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type BulkAssignDialogProps = {
  transactions: TransactionWithDetails[];
  entities: Pick<Entity, "id" | "name" | "slug">[];
  categoriesByEntity: Record<string, EntityCategory[]>;
  defaultEntityId: string;
  entitySlug: string;
  onClose: () => void;
  onComplete: () => void;
};

function BulkAssignDialog({
  transactions,
  entities,
  categoriesByEntity,
  defaultEntityId,
  entitySlug,
  onClose,
  onComplete,
}: BulkAssignDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [entityId, setEntityId] = useState(defaultEntityId);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<CategorySuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);

  const selectedEntity = entities.find((entity) => entity.id === entityId);
  const showCategories = (categoriesByEntity[selectedEntity?.slug ?? ""]?.length ?? 0) > 0;
  const suggestionEntitySlug = selectedEntity?.slug;
  const showSuggestions =
    suggestionEntitySlug === "gbsl" ||
    suggestionEntitySlug === "personal" ||
    suggestionEntitySlug === "acaa-austin" ||
    suggestionEntitySlug === "pflugerville" ||
    suggestionEntitySlug === "keller";
  const totalAmount = transactions.reduce((sum, tx) => sum + Number(tx.amount), 0);
  const suggestionKey = useMemo(
    () =>
      transactions
        .map((tx) => `${tx.description}|${tx.vendor ?? ""}`)
        .sort()
        .join("\n"),
    [transactions],
  );

  useEffect(() => {
    if (!showSuggestions || !suggestionEntitySlug) {
      setSuggestions([]);
      setSuggestionsLoading(false);
      setSuggestionsError(null);
      return;
    }

    let cancelled = false;
    setSuggestionsLoading(true);
    setSuggestionsError(null);

    getBulkCategorySuggestions({
      entitySlug: suggestionEntitySlug,
      transactions: transactions.map((tx) => ({
        description: tx.description,
        vendor: tx.vendor,
        amount: Number(tx.amount),
      })),
    })
      .then((result) => {
        if (cancelled) return;
        setSuggestions(result.suggestions);
        setSuggestionsError(result.error ?? null);
        setSuggestionsLoading(false);
      })
      .catch((fetchError: unknown) => {
        if (cancelled) return;
        setSuggestions([]);
        setSuggestionsError(
          fetchError instanceof Error ? fetchError.message : "Failed to load suggestions",
        );
        setSuggestionsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [showSuggestions, suggestionEntitySlug, suggestionKey, transactions]);

  function handleEntityChange(nextEntityId: string) {
    setEntityId(nextEntityId);
    const nextEntity = entities.find((entity) => entity.id === nextEntityId);
    const nextHasCategories = (categoriesByEntity[nextEntity?.slug ?? ""]?.length ?? 0) > 0;
    if (!nextHasCategories) {
      setCategoryId(null);
    }
  }

  function buildBulkSuggestionOutcome(chosenCategoryId: string | null): SuggestionOutcome | null {
    if (!showSuggestions || suggestions.length === 0 || transactions.length === 0) return null;
    const sample = transactions[0];
    return {
      transactionId: sample.id,
      classificationId: sample.classification.id,
      entityId,
      description: sample.description,
      vendor: sample.vendor,
      chosenCategoryId,
      suggestionsShown: suggestions.map((item) => ({
        categoryId: item.categoryId,
        source: item.source,
      })),
    };
  }

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await bulkReclassifyTransactions({
        classificationIds: transactions.map((tx) => tx.classification.id),
        entityId,
        categoryId: showCategories ? categoryId : null,
        entitySlug,
        suggestionOutcome: buildBulkSuggestionOutcome(showCategories ? categoryId : null),
      });

      if (result.error) {
        setError(result.error);
        return;
      }

      onComplete();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign to {transactions.length} transactions</DialogTitle>
          <DialogDescription>
            Apply the same entity and category to all selected transactions.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md bg-muted p-3 text-sm">
            <p>
              <span className="text-muted-foreground">Selected:</span> {transactions.length} transactions
            </p>
            <p>
              <span className="text-muted-foreground">Combined amount:</span> {formatCurrency(totalAmount)}
            </p>
          </div>

          {showSuggestions ? (
            <CategorySuggestionChips
              suggestions={suggestions}
              selectedCategoryId={categoryId}
              isLoading={suggestionsLoading}
              error={suggestionsError}
              entitySlug={suggestionEntitySlug}
              onSelect={setCategoryId}
            />
          ) : null}

          <ClassificationForm
            entities={entities}
            categoriesByEntity={categoriesByEntity}
            entityId={entityId}
            categoryId={categoryId}
            onEntityChange={handleEntityChange}
            onCategoryChange={setCategoryId}
            entityFieldId="bulk-entity"
            categoryFieldId="bulk-category"
          />

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isPending}>
              {isPending ? "Saving…" : `Apply to ${transactions.length}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
