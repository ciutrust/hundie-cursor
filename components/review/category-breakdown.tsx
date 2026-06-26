import Link from "next/link";
import type { CategoryGroup } from "@/lib/types/database";
import { cn, formatCurrency } from "@/lib/utils";

type CategoryBreakdownProps = {
  groups: CategoryGroup[];
  entitySlug: string;
  periodQuery: string;
  selectedCategoryId?: string | null;
};

export function CategoryBreakdown({
  groups,
  entitySlug,
  periodQuery,
  selectedCategoryId,
}: CategoryBreakdownProps) {
  if (groups.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium">By category</h2>
      </div>
      <div className="divide-y divide-border">
        {groups.map((group) => {
          const categoryParam = group.categoryId ?? "unclassified";
  const isSelected =
    selectedCategoryId !== undefined &&
    (group.categoryId === selectedCategoryId ||
      (group.categoryId === null && selectedCategoryId === null));
          const href =
            categoryParam === "unclassified"
              ? `/review/${entitySlug}/uncategorized?${periodQuery}`
              : `/reports/transactions?entity=${entitySlug}&${periodQuery}`;

          return (
            <Link
              key={group.categoryId ?? "unclassified"}
              href={href}
              className={cn(
                "flex items-center justify-between px-4 py-3 transition-colors hover:bg-accent/50",
                isSelected && "bg-accent/60",
              )}
            >
              <div>
                <p className="font-medium">{group.categoryName}</p>
                <p className="text-sm text-muted-foreground">
                  {group.transactions.length} transaction{group.transactions.length === 1 ? "" : "s"}
                </p>
              </div>
              <span className="font-medium">{formatCurrency(group.total)}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
