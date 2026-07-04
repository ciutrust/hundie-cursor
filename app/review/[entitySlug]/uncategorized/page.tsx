import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PeriodPicker } from "@/components/review/period-picker";
import { TransactionList } from "@/components/review/transaction-list";
import { parsePeriodParams, periodQueryString, ytdPeriod } from "@/lib/period";
import {
  getCategoriesByEntity,
  getCategoriesForEntity,
  getClassifiableEntities,
  getEntityTransactions,
} from "@/lib/queries/review";
import { getPersonalAiBacklog } from "@/lib/queries/ai-suggestions";
import { getSidebarEntityNav } from "@/lib/queries/entity-home";
import { formatCurrency } from "@/lib/utils";
import { isExpenseAmount } from "@/lib/category-expense";

export const maxDuration = 300;

type UncategorizedPageProps = {
  params: Promise<{ entitySlug: string }>;
  searchParams: Promise<{ month?: string; period?: string; at?: string; flow?: string }>;
};

export default async function EntityUncategorizedPage({ params, searchParams }: UncategorizedPageProps) {
  const { entitySlug } = await params;
  const query = await searchParams;
  const period = parsePeriodParams(query, ytdPeriod());
  const periodQuery = periodQueryString(period);
  const isIncome = query.flow === "income";
  const flow = isIncome ? "inflow" : "outflow";

  if (entitySlug === "unclassified" || entitySlug === "entities" || entitySlug === "ai") {
    notFound();
  }

  const [entities, { transactions }, categories, categoriesByEntity, aiBacklog, entityNav] =
    await Promise.all([
      getClassifiableEntities(),
      getEntityTransactions(period, entitySlug, "unclassified", flow),
      getCategoriesForEntity(entitySlug),
      getCategoriesByEntity(),
      entitySlug === "personal" ? getPersonalAiBacklog() : Promise.resolve([]),
      getSidebarEntityNav(period),
    ]);

  const entity = entities.find((item) => item.slug === entitySlug);
  if (!entity) notFound();

  // #8: the next entity (other than this one) that still has a review backlog, for the guided empty state.
  const nextNav = entityNav.find((item) => item.slug !== entitySlug && item.unclassifiedCount > 0);
  const nextUp = nextNav
    ? { slug: nextNav.slug, name: nextNav.name, count: nextNav.unclassifiedCount }
    : null;

  const total = isIncome
    ? transactions.reduce((sum, tx) => sum + Math.abs(Number(tx.amount)), 0)
    : transactions
        // This page lists the uncategorized outflow backlog (rows that are by definition uncategorized
        // or AMA); the header is the gross positive "$ to classify", not an operating-expense total —
        // isBookedOperatingExpense would (correctly) exclude uncategorized and zero it out.
        .filter((tx) => isExpenseAmount(tx.amount))
        .reduce((sum, tx) => sum + Number(tx.amount), 0);

  const aiSuggestionTxIds = new Set(
    aiBacklog.filter((tx) => tx.ai_suggestion).map((tx) => tx.id),
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">
            <Link href={`/review/${entitySlug}?${periodQuery}`} className="hover:text-foreground">
              {entity.name}
            </Link>
            {" · Uncategorized"}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            Classify {isIncome ? "income" : "expenses"} · {entity.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {period.label} ·{" "}
            <span className="font-semibold text-amber-600 dark:text-amber-400">
              {formatCurrency(total)}
            </span>{" "}
            {isIncome ? "money in" : "remaining"} across {transactions.length} transaction
            {transactions.length === 1 ? "" : "s"} to classify
          </p>
          <div className="flex gap-1 text-sm">
            <Link
              href={`/review/${entitySlug}/uncategorized?${periodQuery}`}
              className={
                !isIncome
                  ? "rounded-md bg-primary/15 px-2 py-1 font-medium text-primary"
                  : "rounded-md px-2 py-1 text-muted-foreground hover:text-foreground"
              }
            >
              Expenses
            </Link>
            <Link
              href={`/review/${entitySlug}/uncategorized?${periodQuery}&flow=income`}
              className={
                isIncome
                  ? "rounded-md bg-primary/15 px-2 py-1 font-medium text-primary"
                  : "rounded-md px-2 py-1 text-muted-foreground hover:text-foreground"
              }
            >
              Income
            </Link>
          </div>
          {entitySlug === "personal" ? (
            <Link href="/review/ai" className="text-sm font-medium text-violet-600 hover:underline dark:text-violet-400">
              Bulk AI review →
            </Link>
          ) : null}
        </div>
        <Suspense fallback={null}>
          <PeriodPicker period={period} />
        </Suspense>
      </div>

      <TransactionList
        transactions={transactions}
        entities={entities}
        categories={categories}
        categoriesByEntity={categoriesByEntity}
        month={period.at}
        entitySlug={entitySlug}
        aiSuggestionTxIds={aiSuggestionTxIds.size > 0 ? aiSuggestionTxIds : undefined}
        nextUp={nextUp}
      />
    </div>
  );
}
