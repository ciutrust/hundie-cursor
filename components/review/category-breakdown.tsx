import type { CategoryGroup } from "@/lib/types/database";
import { formatCurrency } from "@/lib/utils";

type CategoryBreakdownProps = {
  groups: CategoryGroup[];
};

export function CategoryBreakdown({ groups }: CategoryBreakdownProps) {
  if (groups.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium">By category</h2>
      </div>
      <div className="divide-y divide-border">
        {groups.map((group) => (
          <div key={group.categoryId ?? "unclassified"} className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="font-medium">{group.categoryName}</p>
              <p className="text-sm text-muted-foreground">
                {group.transactions.length} transaction{group.transactions.length === 1 ? "" : "s"}
              </p>
            </div>
            <span className="font-medium">{formatCurrency(group.total)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
