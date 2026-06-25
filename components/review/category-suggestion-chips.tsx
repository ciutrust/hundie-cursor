"use client";

import { Button } from "@/components/ui/button";
import type { CategorySuggestion } from "@/lib/suggestions/category-suggestions";
import { cn } from "@/lib/utils";

type CategorySuggestionChipsProps = {
  suggestions: CategorySuggestion[];
  selectedCategoryId: string | null;
  isLoading: boolean;
  error?: string | null;
  onSelect: (categoryId: string) => void;
};

export function CategorySuggestionChips({
  suggestions,
  selectedCategoryId,
  isLoading,
  error,
  onSelect,
}: CategorySuggestionChipsProps) {
  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading suggestions from QB history…</p>;
  }

  if (error) {
    return <p className="text-sm text-destructive">Suggestions unavailable: {error}</p>;
  }

  if (suggestions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No QuickBooks category matches for this vendor — pick manually below.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Suggested categories</p>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((suggestion) => {
          const isSelected = selectedCategoryId === suggestion.categoryId;

          return (
            <Button
              key={suggestion.categoryId}
              type="button"
              size="sm"
              variant={isSelected ? "default" : "outline"}
              className={cn("h-auto whitespace-normal py-1.5 text-left", isSelected && "ring-2 ring-ring")}
              onClick={() => onSelect(suggestion.categoryId)}
            >
              {suggestion.fullPath}
              <span className="ml-1 text-xs opacity-70">· {suggestion.count}×</span>
            </Button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Based on QuickBooks training history. Tap a suggestion or pick manually below.
      </p>
    </div>
  );
}
