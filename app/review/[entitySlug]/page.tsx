import Link from "next/link";
import { notFound } from "next/navigation";
import { AiReviewPanel } from "@/components/review/ai-review-panel";
import { CategoryBreakdown } from "@/components/review/category-breakdown";
import { MonthlyCategoryMatrix } from "@/components/review/monthly-category-matrix";
import { MonthlyEntityMatrix } from "@/components/review/monthly-entity-matrix";
import { PeriodPicker } from "@/components/review/period-picker";
import { TransactionList } from "@/components/review/transaction-list";
import { periodQueryString, parsePeriodParams } from "@/lib/period";
import {
  getCategoriesByEntity,
  getCategoriesForEntity,
  getClassifiableEntities,
  getEntityTransactions,
  getMonthlyCategoryMatrix,
  getMonthlyEntityMatrix,
} from "@/lib/queries/review";
import { getPersonalAiBacklog } from "@/lib/queries/ai-suggestions";
import { isOperatingExpense } from "@/lib/category-expense";
import { formatCurrency } from "@/lib/utils";

type EntityReviewPageProps = {
  params: Promise<{ entitySlug: string }>;
  searchParams: Promise<{ month?: string; period?: string; at?: string; category?: string }>;
};

export default async function EntityReviewPage({ params, searchParams }: EntityReviewPageProps) {
  const { entitySlug } = await params;
  const query = await searchParams;
  const period = parsePeriodParams(query);
  const periodQuery = periodQueryString(period);
  const categoryFilter = query.category ?? null;
  const matrixYear = Number(period.start.slice(0, 4));

  const [entities, { groups, transactions }, categories, categoriesByEntity, allGroups, monthlyMatrix, categoryMatrix, aiBacklog] =
    await Promise.all([
      getClassifiableEntities(),
      getEntityTransactions(period, entitySlug, categoryFilter),
      getCategoriesForEntity(entitySlug),
      getCategoriesByEntity(),
      categoryFilter
        ? getEntityTransactions(period, entitySlug).then((result) => result.groups)
        : Promise.resolve(null),
      entitySlug === "unclassified" ? getMonthlyEntityMatrix(matrixYear) : Promise.resolve(null),
      !categoryFilter && entitySlug !== "unclassified"
        ? getMonthlyCategoryMatrix(entitySlug, matrixYear)
        : Promise.resolve(null),
      entitySlug === "personal" && categoryFilter === "unclassified"
        ? getPersonalAiBacklog()
        : Promise.resolve([]),
    ]);

  const entity =
    entitySlug === "unclassified"
      ? { name: "Review backlog", slug: "unclassified" }
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

  const total = transactions
    .filter((tx) => isOperatingExpense(tx.amount, tx.classification.category?.full_path))
    .reduce((sum, tx) => sum + Number(tx.amount), 0);
  const isUnclassifiedView = entitySlug === "unclassified";

  const aiSuggestionTxIds = new Set(
    aiBacklog.filter((tx) => tx.ai_suggestion).map((tx) => tx.id),
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">
            <Link href={`/review?${periodQuery}`} className="hover:text-foreground">
              Classify
            </Link>
            {" · "}
            <Link href={`/review/${entitySlug}?${periodQuery}`} className="hover:text-foreground">
              {entity.name}
            </Link>
            {selectedCategoryName ? ` · ${selectedCategoryName}` : null}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">{selectedCategoryName ?? entity.name}</h1>
          <p className="text-sm text-muted-foreground">
            {period.label} · {formatCurrency(total)} · {transactions.length} transactions
              {isUnclassifiedView ? " · uncategorized + CPA review items still need your call" : null}
          </p>
          {entitySlug === "personal" && categoryFilter !== "unclassified" ? (
            <Link
              href={`/review/personal?${periodQueryString(period, { category: "unclassified" })}`}
              className="inline-flex text-sm font-medium text-violet-600 hover:underline dark:text-violet-400"
            >
              Open AI review for uncategorized →
            </Link>
          ) : null}
        </div>
        <PeriodPicker period={period} />
      </div>

      {isUnclassifiedView && monthlyMatrix ? (
        <MonthlyEntityMatrix
          rows={monthlyMatrix}
          year={matrixYear}
          currentYear={new Date().getFullYear()}
          currentMonth={new Date().getMonth() + 1}
          filterSlugs={["unclassified"]}
          title={`${matrixYear} uncategorized backlog`}
          subtitle="Expenses still missing a category. Click a month to drill in — goal is $0 each month."
        />
      ) : null}

      {!categoryFilter && categoryMatrix && categoryMatrix.length > 0 ? (
        <MonthlyCategoryMatrix
          rows={categoryMatrix}
          entitySlug={entitySlug}
          year={matrixYear}
          currentYear={new Date().getFullYear()}
          currentMonth={new Date().getMonth() + 1}
        />
      ) : null}

      {!categoryFilter ? (
        <CategoryBreakdown groups={breakdownGroups} entitySlug={entitySlug} periodQuery={periodQuery} />
      ) : null}

      {entitySlug === "personal" && categoryFilter === "unclassified" && aiBacklog.length > 0 ? (
        <AiReviewPanel transactions={aiBacklog} entities={entities} />
      ) : null}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Transactions</h2>
          {categoryFilter ? (
            <Link
              href={`/review/${entitySlug}?${periodQuery}`}
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
          month={period.at}
          entitySlug={entitySlug}
          aiSuggestionTxIds={aiSuggestionTxIds.size > 0 ? aiSuggestionTxIds : undefined}
        />
      </section>
    </div>
  );
}
