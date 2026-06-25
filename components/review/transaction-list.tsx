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
import { getBulkCategorySuggestions, getCategorySuggestions } from "@/lib/actions/suggestions";
import type { CategorySuggestion } from "@/lib/suggestions/category-suggestions";
import type { Category, Entity, TransactionWithDetails } from "@/lib/types/database";
import {
  EMPTY_TRANSACTION_FILTERS,
  filterTransactions,
  getAccountFilterOptions,
  getCategoryFilterOptions,
  type TransactionFilterState,
} from "@/lib/transaction-filters";
import { cn, formatCurrency } from "@/lib/utils";

type TransactionListProps = {
  transactions: TransactionWithDetails[];
  entities: Pick<Entity, "id" | "name" | "slug">[];
  categories: Pick<Category, "id" | "full_path">[];
  month: string;
  entitySlug: string;
};

export function TransactionList({
  transactions,
  entities,
  categories,
  month,
  entitySlug,
}: TransactionListProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailTransaction, setDetailTransaction] = useState<TransactionWithDetails | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [filters, setFilters] = useState<TransactionFilterState>(EMPTY_TRANSACTION_FILTERS);

  const filteredTransactions = useMemo(
    () => filterTransactions(transactions, filters),
    [transactions, filters],
  );

  const categoryOptions = useMemo(
    () => getCategoryFilterOptions(transactions),
    [transactions],
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

  const allSelected =
    filteredTransactions.length > 0 && selectedIds.size === filteredTransactions.length;
  const someSelected = selectedIds.size > 0 && !allSelected;

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

  function handleBulkComplete() {
    setBulkOpen(false);
    clearSelection();
  }

  if (transactions.length === 0) {
    return <p className="text-sm text-muted-foreground">No transactions for this view.</p>;
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

      {filteredTransactions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No transactions match your search.</p>
      ) : (
        <>
      <div className="flex items-center justify-between gap-3">
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
        {selectedIds.size > 0 ? (
          <span className="text-sm text-muted-foreground">{selectedIds.size} selected</span>
        ) : null}
      </div>

      <div className="divide-y divide-border rounded-lg border border-border bg-card">
        {filteredTransactions.map((tx) => {
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
                  <p className="truncate font-medium">{tx.description}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {tx.transaction_date} · {tx.account.display_name}
                    {tx.classification.category
                      ? ` · ${tx.classification.category.full_path}`
                      : " · Unclassified"}
                  </p>
                </div>
                <span className="shrink-0 font-medium">{formatCurrency(Number(tx.amount))}</span>
              </button>
            </div>
          );
        })}
      </div>

      {selectedIds.size > 0 ? (
        <div className="sticky bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 shadow-md">
          <p className="text-sm font-medium">
            {selectedIds.size} transaction{selectedIds.size === 1 ? "" : "s"} selected
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
          categories={categories}
          month={month}
          entitySlug={entitySlug}
          onClose={() => setDetailTransaction(null)}
        />
      ) : null}

      {bulkOpen ? (
        <BulkAssignDialog
          transactions={selectedTransactions}
          entities={entities}
          categories={categories}
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
  categories: Pick<Category, "id" | "full_path">[];
  entityId: string;
  categoryId: string | null;
  onEntityChange: (entityId: string) => void;
  onCategoryChange: (categoryId: string | null) => void;
  entityFieldId?: string;
  categoryFieldId?: string;
};

function ClassificationForm({
  entities,
  categories,
  entityId,
  categoryId,
  onEntityChange,
  onCategoryChange,
  entityFieldId = "entity",
  categoryFieldId = "category",
}: ClassificationFormProps) {
  const selectedEntity = entities.find((entity) => entity.id === entityId);
  const showCategories = selectedEntity?.slug === "gbsl";

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
          categories={categories}
          value={categoryId}
          onChange={onCategoryChange}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          Category picker for {selectedEntity?.name ?? "this entity"} coming soon. Entity changes save now;
          category stays unclassified until Hundie-native categories are added.
        </p>
      )}
    </>
  );
}

type ReclassifyDialogProps = {
  transaction: TransactionWithDetails;
  entities: Pick<Entity, "id" | "name" | "slug">[];
  categories: Pick<Category, "id" | "full_path">[];
  month: string;
  entitySlug: string;
  onClose: () => void;
};

function ReclassifyDialog({
  transaction,
  entities,
  categories,
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
  const showCategories = selectedEntity?.slug === "gbsl";

  useEffect(() => {
    if (!showCategories) {
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
      entitySlug: "gbsl",
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
  }, [showCategories, transaction.description, transaction.vendor]);

  function handleEntityChange(nextEntityId: string) {
    setEntityId(nextEntityId);
    const nextEntity = entities.find((entity) => entity.id === nextEntityId);
    if (nextEntity?.slug !== "gbsl") {
      setCategoryId(null);
    }
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

          {showCategories ? (
            <CategorySuggestionChips
              suggestions={suggestions}
              selectedCategoryId={categoryId}
              isLoading={suggestionsLoading}
              error={suggestionsError}
              onSelect={setCategoryId}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Set entity to <span className="font-medium">GBSL, LLC</span> to see category suggestions from QuickBooks history.
            </p>
          )}

          <ClassificationForm
            entities={entities}
            categories={categories}
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
  categories: Pick<Category, "id" | "full_path">[];
  defaultEntityId: string;
  entitySlug: string;
  onClose: () => void;
  onComplete: () => void;
};

function BulkAssignDialog({
  transactions,
  entities,
  categories,
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
  const showCategories = selectedEntity?.slug === "gbsl";
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
    if (!showCategories) {
      setSuggestions([]);
      setSuggestionsLoading(false);
      setSuggestionsError(null);
      return;
    }

    let cancelled = false;
    setSuggestionsLoading(true);
    setSuggestionsError(null);

    getBulkCategorySuggestions({
      entitySlug: "gbsl",
      transactions: transactions.map((tx) => ({
        description: tx.description,
        vendor: tx.vendor,
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
  }, [showCategories, suggestionKey]);

  function handleEntityChange(nextEntityId: string) {
    setEntityId(nextEntityId);
    const nextEntity = entities.find((entity) => entity.id === nextEntityId);
    if (nextEntity?.slug !== "gbsl") {
      setCategoryId(null);
    }
  }

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await bulkReclassifyTransactions({
        classificationIds: transactions.map((tx) => tx.classification.id),
        entityId,
        categoryId: showCategories ? categoryId : null,
        entitySlug,
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

          {showCategories ? (
            <CategorySuggestionChips
              suggestions={suggestions}
              selectedCategoryId={categoryId}
              isLoading={suggestionsLoading}
              error={suggestionsError}
              onSelect={setCategoryId}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Set entity to <span className="font-medium">GBSL, LLC</span> to see category suggestions from QuickBooks history.
            </p>
          )}

          <ClassificationForm
            entities={entities}
            categories={categories}
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
