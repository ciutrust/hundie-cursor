"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FilterMultiSelect } from "@/components/review/filter-multi-select";
import {
  EMPTY_TRANSACTION_FILTERS,
  hasActiveTransactionFilters,
  selectedFilterLabels,
  type AccountFilterOption,
  type AmountOperator,
  type CategoryFilterOption,
  type TransactionFilterState,
} from "@/lib/transaction-filters";
import { cn } from "@/lib/utils";

type TransactionSearchBarProps = {
  filters: TransactionFilterState;
  onChange: (filters: TransactionFilterState) => void;
  resultCount: number;
  totalCount: number;
  categoryOptions: CategoryFilterOption[];
  accountOptions: AccountFilterOption[];
};

const AMOUNT_OPERATOR_LABELS: Record<AmountOperator, string> = {
  any: "Any amount",
  eq: "Equals",
  gt: "More than",
  lt: "Less than",
};

function filterSummary(
  filters: TransactionFilterState,
  categoryOptions: CategoryFilterOption[],
  accountOptions: AccountFilterOption[],
): string | null {
  const parts: string[] = [];

  if (filters.searchText.trim()) {
    parts.push(`"${filters.searchText.trim()}"`);
  }

  const categoryLabels = selectedFilterLabels(categoryOptions, filters.categoryIds);
  if (categoryLabels.length === 1) {
    parts.push(categoryLabels[0]);
  } else if (categoryLabels.length > 1) {
    parts.push(`${categoryLabels.length} categories`);
  }

  const accountLabels = selectedFilterLabels(accountOptions, filters.accountIds);
  if (accountLabels.length === 1) {
    parts.push(accountLabels[0]);
  } else if (accountLabels.length > 1) {
    parts.push(`${accountLabels.length} accounts`);
  }

  if (filters.amountOperator !== "any" && filters.amountValue.trim()) {
    const op = AMOUNT_OPERATOR_LABELS[filters.amountOperator].toLowerCase();
    parts.push(`${op} ${filters.amountValue.trim()}`);
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

export function TransactionSearchBar({
  filters,
  onChange,
  resultCount,
  totalCount,
  categoryOptions,
  accountOptions,
}: TransactionSearchBarProps) {
  const active = hasActiveTransactionFilters(filters);
  const summary = filterSummary(filters, categoryOptions, accountOptions);
  const [expanded, setExpanded] = useState(active);

  function update(partial: Partial<TransactionFilterState>) {
    onChange({ ...filters, ...partial });
  }

  function clearFilters() {
    onChange(EMPTY_TRANSACTION_FILTERS);
  }

  const showFilterRow = categoryOptions.length > 0 || accountOptions.length > 0;

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-accent/30"
        aria-expanded={expanded}
      >
        <div className="flex min-w-0 items-center gap-2">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium">Search & filters</span>
          {summary ? (
            <span className="truncate text-sm text-muted-foreground">· {summary}</span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {active ? (
            <span className="text-xs text-muted-foreground">
              {resultCount}/{totalCount}
            </span>
          ) : null}
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>

      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out",
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <div className="space-y-3 border-t border-border px-4 pb-4 pt-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                <Label htmlFor="transaction-search" className="sr-only">
                  Search
                </Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="transaction-search"
                    type="search"
                    placeholder="Name, vendor, account, amount…"
                    value={filters.searchText}
                    onChange={(event) => update({ searchText: event.target.value })}
                    className="w-full pl-9"
                  />
                </div>
              </div>

              <div className="flex shrink-0 items-end gap-3">
                <div className="min-w-[9rem] flex-1 sm:flex-none">
                  <Label htmlFor="amount-operator" className="sr-only">
                    Amount
                  </Label>
                  <Select
                    value={filters.amountOperator}
                    onValueChange={(value) =>
                      update({
                        amountOperator: value as AmountOperator,
                        amountValue: value === "any" ? "" : filters.amountValue,
                      })
                    }
                  >
                    <SelectTrigger id="amount-operator" className="w-full sm:w-[9rem]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(AMOUNT_OPERATOR_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="min-w-[7rem] flex-1 sm:w-28 sm:flex-none">
                  <Label htmlFor="amount-value" className="sr-only">
                    Amount value
                  </Label>
                  <Input
                    id="amount-value"
                    type="text"
                    inputMode="decimal"
                    placeholder="$0.00"
                    value={filters.amountValue}
                    disabled={filters.amountOperator === "any"}
                    onChange={(event) => update({ amountValue: event.target.value })}
                    className="w-full"
                  />
                </div>

                {active ? (
                  <Button type="button" variant="outline" onClick={clearFilters} className="shrink-0">
                    <X className="h-4 w-4" />
                    Clear
                  </Button>
                ) : null}
              </div>
            </div>

            {showFilterRow ? (
              <div className="flex flex-col gap-3 sm:flex-row">
                {categoryOptions.length > 0 ? (
                  <FilterMultiSelect
                    id="category-filter"
                    label="Categories"
                    emptyLabel="All categories"
                    options={categoryOptions}
                    selectedIds={filters.categoryIds}
                    onChange={(categoryIds) => update({ categoryIds })}
                  />
                ) : null}
                {accountOptions.length > 0 ? (
                  <FilterMultiSelect
                    id="account-filter"
                    label="Accounts"
                    emptyLabel="All accounts"
                    options={accountOptions}
                    selectedIds={filters.accountIds}
                    onChange={(accountIds) => update({ accountIds })}
                  />
                ) : null}
              </div>
            ) : null}

            {active ? (
              <p className="text-sm text-muted-foreground">
                Showing {resultCount} of {totalCount} transaction{totalCount === 1 ? "" : "s"}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
