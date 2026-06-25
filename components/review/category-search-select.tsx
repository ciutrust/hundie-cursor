"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Category } from "@/lib/types/database";
import { cn } from "@/lib/utils";

type CategorySearchSelectProps = {
  id: string;
  label?: string;
  categories: Pick<Category, "id" | "full_path">[];
  value: string | null;
  onChange: (categoryId: string | null) => void;
};

export function CategorySearchSelect({
  id,
  label = "Category (GBSL)",
  categories,
  value,
  onChange,
}: CategorySearchSelectProps) {
  const [query, setQuery] = useState("");

  const selectedCategory = categories.find((category) => category.id === value);

  const filteredCategories = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return categories;
    }

    return categories.filter((category) => category.full_path.toLowerCase().includes(normalizedQuery));
  }, [categories, query]);

  const showUnclassified =
    !query.trim() || "unclassified".includes(query.trim().toLowerCase());

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>

      {selectedCategory ? (
        <p className="text-sm">
          <span className="text-muted-foreground">Selected:</span> {selectedCategory.full_path}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Selected: Unclassified</p>
      )}

      <Input
        id={id}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search categories…"
        autoComplete="off"
      />

      <div
        role="listbox"
        aria-label="Category options"
        className="max-h-48 overflow-y-auto rounded-md border border-border bg-background p-1"
      >
        {showUnclassified ? (
          <button
            type="button"
            role="option"
            aria-selected={value === null}
            onClick={() => onChange(null)}
            className={cn(
              "flex w-full rounded-sm px-2 py-2 text-left text-sm hover:bg-accent",
              value === null && "bg-accent/60 font-medium",
            )}
          >
            Unclassified
          </button>
        ) : null}

        {filteredCategories.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">No categories match “{query.trim()}”.</p>
        ) : (
          filteredCategories.map((category) => {
            const isSelected = value === category.id;

            return (
              <button
                key={category.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => onChange(category.id)}
                className={cn(
                  "flex w-full rounded-sm px-2 py-2 text-left text-sm hover:bg-accent",
                  isSelected && "bg-accent/60 font-medium",
                )}
              >
                {category.full_path}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
