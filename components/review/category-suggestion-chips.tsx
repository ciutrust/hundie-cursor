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

function suggestionSourceCopy(
  source: CategorySuggestion["source"] | undefined,
  entitySlug: string,
  hasAmountMatch: boolean,
) {
  if (hasAmountMatch) {
    return {
      loading: "Loading suggestions from amount + your past picks…",
      empty: "No amount match for this vendor — choose manually below.",
      footer:
        "Ranked by amount bucket from your confirmed history · green = strong · yellow = possible · red = weak.",
    };
  }

  const resolved = source ?? (entitySlug === "gbsl" ? "blended" : "confirmed_history");

  if (resolved === "confirmed_history") {
    return {
      loading: "Loading suggestions from your past classifications…",
      empty: "No matches from your past picks for this vendor — choose manually below.",
      footer: "Green = strong match from your history · yellow = possible · red = weak guess.",
    };
  }

  if (resolved === "blended") {
    return {
      loading: "Loading blended suggestions (QB + your picks)…",
      empty: "No blended matches for this vendor — choose manually below.",
      footer:
        "Blends QuickBooks history, your confirmed picks, and recent accept/reject learning.",
    };
  }

  if (resolved === "ai_llm") {
    return {
      loading: "Loading AI suggestion…",
      empty: "No AI suggestion for this transaction — run Ask AI from the review panel.",
      footer: "AI guess from batch pre-classifier · confirm before saving · feeds learning when accepted.",
    };
  }

  return {
    loading: "Loading suggestions from QB history…",
    empty: "No QuickBooks matches for this vendor — choose manually below.",
    footer: "Green = strong QB history match · yellow = possible · red = weak guess.",
  };
}

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
  const hasAmountMatch = suggestions.some(
    (suggestion) => suggestion.source === "amount_match" || suggestion.amountMatchType,
  );
  const hasAi = suggestions.some((suggestion) => suggestion.source === "ai_llm");
  const copy = suggestionSourceCopy(suggestions[0]?.source, entitySlug, hasAmountMatch);

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">{copy.loading}</p>;
  }

  if (error) {
    return <p className="text-sm text-destructive">Suggestions unavailable: {error}</p>;
  }

  if (suggestions.length === 0) {
    return <p className="text-sm text-muted-foreground">{copy.empty}</p>;
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm font-medium">Suggested categories</p>
        {hasAi ? (
          <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-xs font-medium text-violet-700 dark:text-violet-300">
            AI
          </span>
        ) : null}
        {hasAmountMatch ? (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            Amount match
          </span>
        ) : null}
        <div className="flex gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> High</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> Medium</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500" /> Low</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((suggestion) => {
          const isSelected = selectedCategoryId === suggestion.categoryId;
          const styles = suggestion.source === "ai_llm"
            ? {
                chip: "border-violet-500/40 bg-violet-500/5 hover:bg-violet-500/10",
                dot: "bg-violet-500",
                label: "AI suggestion",
              }
            : CONFIDENCE_STYLES[suggestion.confidence];
          const amountHint =
            suggestion.amountMatchType === "exact"
              ? " · exact amount"
              : suggestion.amountMatchType === "nearest"
                ? " · similar amount"
                : "";

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
              title={
                suggestion.rationale
                  ? `${styles.label} — ${suggestion.rationale}`
                  : styles.label
              }
              onClick={() => onSelect(suggestion.categoryId)}
            >
              <span className={cn("mr-2 inline-block h-2 w-2 shrink-0 rounded-full", styles.dot)} />
              {suggestion.source === "ai_llm" ? "AI: " : null}
              {suggestion.fullPath}
              <span className="ml-1 text-xs opacity-70">
                {suggestion.source === "ai_llm"
                  ? amountHint
                  : ` · ${suggestion.count}×${amountHint}`}
              </span>
            </Button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">{copy.footer}</p>
    </div>
  );
}
