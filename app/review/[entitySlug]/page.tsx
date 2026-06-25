import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/layout/app-header";
import { CategoryBreakdown } from "@/components/review/category-breakdown";
import { MonthPicker } from "@/components/review/month-picker";
import { TransactionList } from "@/components/review/transaction-list";
import {
  getCategoriesByEntity,
  getCategoriesForEntity,
  getClassifiableEntities,
  getEntityTransactions,
} from "@/lib/queries/review";
import { formatCurrency, monthLabel, parseMonthParam } from "@/lib/utils";

type EntityReviewPageProps = {
  params: Promise<{ entitySlug: string }>;
  searchParams: Promise<{ month?: string; category?: string }>;
};

export default async function EntityReviewPage({ params, searchParams }: EntityReviewPageProps) {
  const { entitySlug } = await params;
  const query = await searchParams;
  const { year, month } = parseMonthParam(query.month);
  const monthParam = `${year}-${String(month).padStart(2, "0")}`;
  const categoryFilter = query.category ?? null;
  const selectedCategoryId =
    categoryFilter === "unclassified" ? null : categoryFilter;

  const [entities, { groups, transactions }, categories, categoriesByEntity, allGroups] =
    await Promise.all([
      getClassifiableEntities(),
      getEntityTransactions(year, month, entitySlug, categoryFilter),
      getCategoriesForEntity(entitySlug),
      getCategoriesByEntity(),
      categoryFilter
        ? getEntityTransactions(year, month, entitySlug).then((result) => result.groups)
        : Promise.resolve(null),
    ]);

  const entity =
    entitySlug === "unclassified"
      ? { name: "Unclassified", slug: "unclassified" }
      : entities.find((item) => item.slug === entitySlug);

  if (!entity) {
    notFound();
  }

  const breakdownGroups = categoryFilter ? (allGroups ?? groups) : groups;
  const selectedCategoryName = categoryFilter
    ? breakdownGroups.find((group) =>
        categoryFilter === "unclassified"
          ? group.categoryId === null
          : group.categoryId === categoryFilter,
      )?.categoryName ?? "Category"
    : null;

  const total = transactions.filter((tx) => Number(tx.amount) > 0).reduce((sum, tx) => sum + Number(tx.amount), 0);

  return (
    <div className="min-h-screen bg-background">
      <AppHeader title={entity.name} backHref={`/review?month=${monthParam}`} />
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm text-muted-foreground">
              <Link href={`/review?month=${monthParam}`} className="hover:text-foreground">
                Review
              </Link>
              {" · "}
              <Link href={`/review/${entitySlug}?month=${monthParam}`} className="hover:text-foreground">
                {entity.name}
              </Link>
              {selectedCategoryName ? ` · ${selectedCategoryName}` : null}
            </p>
            <h2 className="text-2xl font-semibold">
              {selectedCategoryName ?? entity.name}
            </h2>
            <p className="text-sm text-muted-foreground">
              {monthLabel(year, month)} · {formatCurrency(total)} · {transactions.length} transactions
            </p>
          </div>
          <MonthPicker year={year} month={month} />
        </div>

        {!categoryFilter ? (
          <CategoryBreakdown
            groups={breakdownGroups}
            entitySlug={entitySlug}
            month={monthParam}
          />
        ) : null}

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Transactions</h3>
            {categoryFilter ? (
              <Link
                href={`/review/${entitySlug}?month=${monthParam}`}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Clear category filter
              </Link>
            ) : null}
          </div>
          <TransactionList
            transactions={transactions}
            entities={entities}
            categories={categories}
            categoriesByEntity={categoriesByEntity}
            month={monthParam}
            entitySlug={entitySlug}
          />
        </section>
      </main>
    </div>
  );
}
