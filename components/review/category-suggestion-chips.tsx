"use client";

import { Button } from "@/components/ui/button";
import type { CategorySuggestion } from "@/lib/suggestions/category-suggestions";
import { cn } from "@/lib/utils";

const CONFIDENCE_STYLES = {
  high: {
    chip: "border-emerald-500/40 bg-emerald-500/5 hover:bg-emerald-500/10",
    dot: "bg-emerald-500",
    label: "High confidence",
  },
  medium: {
    chip: "border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10",
    dot: "bg-amber-500",
    label: "Medium confidence",
  },
  low: {
    chip: "border-red-500/40 bg-red-500/5 hover:bg-red-500/10",
    dot: "bg-red-500",
    label: "Low confidence",
  },
} as const;

type CategorySuggestionChipsProps = {
  suggestions: CategorySuggestion[];
  selectedCategoryId: string | null;
  isLoading: boolean;
  error?: string | null;
  entitySlug?: string;
  onSelect: (categoryId: string) => void;
};

export function CategorySuggestionChips({
  suggestions,
  selectedCategoryId,
  isLoading,
  error,
  entitySlug = "gbsl",
  onSelect,
}: CategorySuggestionChipsProps) {
  const source = suggestions[0]?.source ?? (entitySlug === "gbsl" ? "qb_training" : "confirmed_history");
  const loadingMessage =
    source === "confirmed_history"
      ? "Loading suggestions from your past classifications…"
      : "Loading suggestions from QB history…";
  const emptyMessage =
    source === "confirmed_history"
      ? "No matches from your past picks for this vendor — choose manually below."
      : "No QuickBooks matches for this vendor — choose manually below.";
  const footerMessage =
    source === "confirmed_history"
      ? "Green = strong match from your history · yellow = possible · red = weak guess."
      : "Green = strong QB history match · yellow = possible · red = weak guess.";

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">{loadingMessage}</p>;
  }

  if (error) {
    return <p className="text-sm text-destructive">Suggestions unavailable: {error}</p>;
  }

  if (suggestions.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm font-medium">Suggested categories</p>
        <div className="flex gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> High</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> Medium</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500" /> Low</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((suggestion) => {
          const isSelected = selectedCategoryId === suggestion.categoryId;
          const styles = CONFIDENCE_STYLES[suggestion.confidence];

          return (
            <Button
              key={suggestion.categoryId}
              type="button"
              size="sm"
              variant={isSelected ? "default" : "outline"}
              className={cn(
                "h-auto border py-2 text-left whitespace-normal",
                !isSelected && styles.chip,
                isSelected && "ring-2 ring-ring",
              )}
              title={styles.label}
              onClick={() => onSelect(suggestion.categoryId)}
            >
              <span className={cn("mr-2 inline-block h-2 w-2 shrink-0 rounded-full", styles.dot)} />
              {suggestion.fullPath}
              <span className="ml-1 text-xs opacity-70">· {suggestion.count}×</span>
            </Button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">{footerMessage}</p>
    </div>
  );
}
